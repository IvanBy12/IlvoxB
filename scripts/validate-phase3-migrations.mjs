import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";

const useDatabaseUrl = process.argv.includes("--database-url");
const variable = useDatabaseUrl ? "DATABASE_URL" : "TEST_DATABASE_URL";
const connectionString = process.env[variable];
if (connectionString === undefined || connectionString.trim() === "") {
  console.error(`${variable}_MISSING`);
  process.exit(2);
}

const baselinePath = resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql");
const baseline = readFileSync(baselinePath, "utf8");
const expectedHash = "46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6";
const actualHash = createHash("sha256").update(baseline).digest("hex").toUpperCase();
if (actualHash !== expectedHash) throw new Error("BASELINE_HASH_MISMATCH");

const migrationPaths = [
  resolve("drizzle", "migrations", "0001_phase3-rbac-separation.sql"),
  resolve("drizzle", "migrations", "0002_phase3-file-audience.sql"),
  resolve("drizzle", "migrations", "0003_phase3-clerk-event-idempotency.sql"),
];
const rollbackPaths = [
  resolve("drizzle", "rollbacks", "0003_phase3-clerk-event-idempotency.down.sql"),
  resolve("drizzle", "rollbacks", "0002_phase3-file-audience.down.sql"),
  resolve("drizzle", "rollbacks", "0001_phase3-rbac-separation.down.sql"),
];
const schema = `ilvox_phase3_${randomBytes(6).toString("hex")}`;
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const client = new pg.Client({ connectionString });

async function catalog(targetSchema) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::integer FROM information_schema.columns WHERE table_schema=$1) AS columns,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='f') AS fks,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='c') AS checks,
      (SELECT count(*)::integer FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='u') AS uniques,
      (SELECT count(*)::integer FROM pg_indexes WHERE schemaname=$1 AND indexname NOT LIKE '%_pkey' AND indexname NOT IN (
        SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='u'
      )) AS explicit_indexes
  `, [targetSchema]);
  return result.rows[0];
}

async function publicFingerprint() {
  const structure = await catalog("public");
  const rbac = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM public.roles) AS roles,
      (SELECT count(*)::integer FROM public.permissions) AS permissions,
      (SELECT count(*)::integer FROM public.role_permissions) AS associations
  `);
  return { ...structure, ...rbac.rows[0] };
}

try {
  await client.connect();
  const publicBefore = await publicFingerprint();
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET search_path TO ${quote(schema)}, public`);
  await client.query(baseline);

  for (const path of migrationPaths) {
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const migratedCatalog = await catalog(schema);
  const rbac = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM roles) AS roles,
      (SELECT count(*)::integer FROM permissions) AS permissions,
      (SELECT count(*)::integer FROM role_permissions) AS associations,
      (SELECT count(*)::integer FROM (SELECT DISTINCT role_id,permission_id FROM role_permissions) d) AS distinct_associations,
      (SELECT count(*)::integer FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id
       WHERE p.code IN ('permissions.manage','roles.assign_super_admin','security.manage','system.configure','organizations.access_all')
       AND NOT (r.scope='global' AND r.code='super_admin')) AS sensitive_leaks
  `);
  const phase3Columns = await client.query(`
    SELECT table_name, column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema=$1 AND (
      (table_name='files' AND column_name='audience') OR
      (table_name='identity_webhook_events' AND column_name IN
        ('clerk_occurred_at','received_at','payload_sha256','last_error_code')))
    ORDER BY table_name,column_name
  `, [schema]);
  const expectedMigrated = { tables: 19, columns: 204, fks: 43, checks: 57, uniques: 15, explicit_indexes: 54 };
  if (JSON.stringify(migratedCatalog) !== JSON.stringify(expectedMigrated)) {
    throw new Error(`MIGRATED_CATALOG_MISMATCH ${JSON.stringify(migratedCatalog)}`);
  }
  const rbacRow = rbac.rows[0];
  if (rbacRow.roles !== 11 || rbacRow.permissions !== 36 || rbacRow.associations !== 157 ||
      rbacRow.distinct_associations !== 157 || rbacRow.sensitive_leaks !== 0) {
    throw new Error(`MIGRATED_RBAC_MISMATCH ${JSON.stringify(rbacRow)}`);
  }
  if (phase3Columns.rowCount !== 5) throw new Error("PHASE3_COLUMNS_MISSING");

  for (const path of rollbackPaths) await client.query(readFileSync(path, "utf8"));
  const rolledBackCatalog = await catalog(schema);
  const rolledBackRbac = await client.query(`SELECT
    (SELECT count(*)::integer FROM roles) AS roles,
    (SELECT count(*)::integer FROM permissions) AS permissions,
    (SELECT count(*)::integer FROM role_permissions) AS associations`);
  const expectedBaseline = { tables: 19, columns: 199, fks: 43, checks: 55, uniques: 15, explicit_indexes: 53 };
  if (JSON.stringify(rolledBackCatalog) !== JSON.stringify(expectedBaseline) ||
      JSON.stringify(rolledBackRbac.rows[0]) !== JSON.stringify({ roles: 11, permissions: 23, associations: 142 })) {
    throw new Error("ROLLBACK_MISMATCH");
  }

  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
  const publicAfter = await publicFingerprint();
  if (JSON.stringify(publicBefore) !== JSON.stringify(publicAfter)) throw new Error("PUBLIC_CHANGED");
  console.log(JSON.stringify({
    ok: true, schema, publicUnchanged: true,
    migrated: { ...migratedCatalog, ...rbacRow, phase3Columns: phase3Columns.rows },
    rolledBack: { ...rolledBackCatalog, ...rolledBackRbac.rows[0] },
    cleanup: true,
  }, null, 2));
} finally {
  if (!client.ended) {
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
