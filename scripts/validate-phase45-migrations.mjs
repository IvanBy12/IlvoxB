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

const migrationNames = [
  "0001_phase3-rbac-separation.sql",
  "0002_phase3-file-audience.sql",
  "0003_phase3-clerk-event-idempotency.sql",
  "0004_phase4-5-lead-standalone-conversion.sql",
  "0005_phase4-5-services-manage.sql",
];
const rollbackServices = resolve(
  "drizzle",
  "rollbacks",
  "0005_phase4-5-services-manage.down.sql",
);
const rollbackLeads = resolve(
  "drizzle",
  "rollbacks",
  "0004_phase4-5-lead-standalone-conversion.down.sql",
);
const schema = `ilvox_phase45_${randomBytes(6).toString("hex")}`;
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

async function rbac() {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM roles) AS roles,
      (SELECT count(*)::integer FROM permissions) AS permissions,
      (SELECT count(*)::integer FROM role_permissions) AS associations,
      (SELECT count(*)::integer FROM (
        SELECT DISTINCT role_id, permission_id FROM role_permissions
      ) d) AS distinct_associations,
      (SELECT count(*)::integer
       FROM role_permissions rp
       JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id
       WHERE p.code='services.manage'
         AND r.scope='global'
         AND r.code IN ('super_admin','admin')) AS services_manage_targets,
      (SELECT count(*)::integer
       FROM role_permissions rp
       JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id
       WHERE p.code='services.manage'
         AND NOT (r.scope='global' AND r.code IN ('super_admin','admin'))) AS services_manage_leaks
  `);
  return result.rows[0];
}

async function publicFingerprint() {
  const structure = await catalog("public");
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM public.roles) AS roles,
      (SELECT count(*)::integer FROM public.permissions) AS permissions,
      (SELECT count(*)::integer FROM public.role_permissions) AS associations
  `);
  return { ...structure, ...result.rows[0] };
}

async function applySql(path) {
  await client.query(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
}

try {
  await client.connect();
  const publicBefore = await publicFingerprint();
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET search_path TO ${quote(schema)}, public`);
  await client.query(baseline);

  for (const name of migrationNames) {
    await applySql(resolve("drizzle", "migrations", name));
  }

  const migratedCatalog = await catalog(schema);
  const migratedRbac = await rbac();
  const expectedCatalog = {
    tables: 19,
    columns: 204,
    fks: 43,
    checks: 57,
    uniques: 15,
    explicit_indexes: 54,
  };
  const expectedRbac = {
    roles: 11,
    permissions: 37,
    associations: 159,
    distinct_associations: 159,
    services_manage_targets: 2,
    services_manage_leaks: 0,
  };
  if (JSON.stringify(migratedCatalog) !== JSON.stringify(expectedCatalog)) {
    throw new Error(`PHASE45_CATALOG_MISMATCH ${JSON.stringify(migratedCatalog)}`);
  }
  if (JSON.stringify(migratedRbac) !== JSON.stringify(expectedRbac)) {
    throw new Error(`PHASE45_RBAC_MISMATCH ${JSON.stringify(migratedRbac)}`);
  }

  const standaloneLeadId = "45000000-0000-4000-8000-000000000001";
  await client.query(
    `INSERT INTO leads (
       id, full_name, email, message, source, status, converted_at
     ) VALUES ($1, 'Standalone validation', 'standalone-validation@example.test',
       'Migration validation', 'contact', 'converted', now())`,
    [standaloneLeadId],
  );
  const standalone = await client.query(`
    SELECT status, converted_at IS NOT NULL AS has_converted_at,
           converted_organization_id
    FROM leads WHERE id=$1
  `, [standaloneLeadId]);
  if (standalone.rows[0]?.status !== "converted" ||
      standalone.rows[0]?.has_converted_at !== true ||
      standalone.rows[0]?.converted_organization_id !== null) {
    throw new Error("STANDALONE_CONVERSION_CHECK_FAILED");
  }

  await applySql(rollbackServices);
  const rolledBackRbac = await rbac();
  if (rolledBackRbac.permissions !== 36 ||
      rolledBackRbac.associations !== 157 ||
      rolledBackRbac.distinct_associations !== 157 ||
      rolledBackRbac.services_manage_targets !== 0 ||
      rolledBackRbac.services_manage_leaks !== 0) {
    throw new Error(`SERVICES_ROLLBACK_MISMATCH ${JSON.stringify(rolledBackRbac)}`);
  }

  let rollbackGuarded = false;
  try {
    await applySql(rollbackLeads);
  } catch {
    rollbackGuarded = true;
    await client.query("ROLLBACK").catch(() => undefined);
  }
  if (!rollbackGuarded) throw new Error("STANDALONE_ROLLBACK_GUARD_MISSING");

  await client.query("DELETE FROM leads WHERE id=$1", [standaloneLeadId]);
  await applySql(rollbackLeads);
  let oldCheckRejectedStandalone = false;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO leads (
         full_name, email, message, source, status, converted_at
       ) VALUES ('Rollback validation', 'rollback-validation@example.test',
         'Must fail', 'contact', 'converted', now())`,
    );
  } catch {
    oldCheckRejectedStandalone = true;
  } finally {
    await client.query("ROLLBACK");
  }
  if (!oldCheckRejectedStandalone) throw new Error("LEAD_ROLLBACK_CHECK_MISMATCH");

  const rolledBackCatalog = await catalog(schema);
  if (JSON.stringify(rolledBackCatalog) !== JSON.stringify(expectedCatalog)) {
    throw new Error(`ROLLBACK_CATALOG_MISMATCH ${JSON.stringify(rolledBackCatalog)}`);
  }

  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
  const publicAfter = await publicFingerprint();
  if (JSON.stringify(publicBefore) !== JSON.stringify(publicAfter)) {
    throw new Error("PUBLIC_CHANGED");
  }

  console.log(JSON.stringify({
    ok: true,
    schema,
    publicUnchanged: true,
    migrated: { ...migratedCatalog, ...migratedRbac },
    standaloneConversion: true,
    rollbackGuarded,
    rolledBack: { ...rolledBackCatalog, ...rolledBackRbac },
    cleanup: true,
  }, null, 2));
} finally {
  if (!client.ended) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
