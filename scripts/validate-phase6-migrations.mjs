import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
  "0006_phase5-member-revocation.sql",
  "0007_phase5-deliverable-milestone.sql",
  "0008_phase6-tickets.sql",
];
const rollbackPath = resolve("drizzle", "rollbacks", "0008_phase6-tickets.down.sql");
const schema = `ilvox_phase6_${randomBytes(6).toString("hex")}`;
const historySchema = `${schema}_history`;
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

async function applySql(path) {
  await client.query("BEGIN");
  try {
    await client.query(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function expectFailure(sql, values, code) {
  await client.query("BEGIN");
  let actual;
  try {
    await client.query(sql, values);
  } catch (error) {
    actual = error?.code;
  } finally {
    await client.query("ROLLBACK");
  }
  if (actual !== code) throw new Error(`EXPECTED_SQLSTATE_${code}_GOT_${actual ?? "success"}`);
}

try {
  await client.connect();
  const publicBefore = await publicFingerprint();
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`CREATE SCHEMA ${quote(historySchema)}`);
  await client.query(`SET search_path TO ${quote(schema)}, public`);
  await client.query(baseline);
  for (const name of migrationNames.slice(0, -1)) {
    await applySql(resolve("drizzle", "migrations", name));
  }
  await client.query(`
    CREATE TABLE ${quote(historySchema)}.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const journal = JSON.parse(readFileSync(
    resolve("drizzle", "migrations", "meta", "_journal.json"),
    "utf8",
  ));
  for (const entry of journal.entries.slice(0, 8)) {
    const sql = readFileSync(
      resolve("drizzle", "migrations", `${entry.tag}.sql`),
    );
    const hash = createHash("sha256").update(sql).digest("hex");
    await client.query(
      `INSERT INTO ${quote(historySchema)}.__drizzle_migrations (hash,created_at)
       VALUES ($1,$2)`,
      [hash, entry.when],
    );
  }
  const migrationPool = new pg.Pool({
    connectionString,
    max: 1,
    options: `-c search_path=${schema},public`,
  });
  try {
    const database = drizzle(migrationPool);
    await migrate(database, {
      migrationsFolder: resolve("drizzle", "migrations"),
      migrationsSchema: historySchema,
    });
    const historyAfterFirst = await client.query(
      `SELECT count(*)::integer AS count, max(created_at)::text AS latest
       FROM ${quote(historySchema)}.__drizzle_migrations`,
    );
    await migrate(database, {
      migrationsFolder: resolve("drizzle", "migrations"),
      migrationsSchema: historySchema,
    });
    const historyAfterSecond = await client.query(
      `SELECT count(*)::integer AS count, max(created_at)::text AS latest
       FROM ${quote(historySchema)}.__drizzle_migrations`,
    );
    if (JSON.stringify(historyAfterFirst.rows[0]) !== JSON.stringify(historyAfterSecond.rows[0]) ||
        historyAfterSecond.rows[0]?.count !== 9) {
      throw new Error("PHASE6_SECOND_MIGRATE_NOT_NOOP");
    }
  } finally {
    await migrationPool.end();
  }

  const migrated = await catalog(schema);
  const expectedMigrated = {
    tables: 19,
    columns: 208,
    fks: 47,
    checks: 60,
    uniques: 16,
    explicit_indexes: 58,
  };
  if (JSON.stringify(migrated) !== JSON.stringify(expectedMigrated)) {
    throw new Error(`PHASE6_CATALOG_MISMATCH ${JSON.stringify(migrated)}`);
  }

  const requester = "62000000-0000-4000-8000-000000000001";
  const organization = "62000000-0000-4000-8000-000000000101";
  const project = "62000000-0000-4000-8000-000000000201";
  await client.query(
    `INSERT INTO app_users (id,clerk_user_id,primary_email,status)
     VALUES ($1,'phase6_validator','phase6-validator@example.test','active')`,
    [requester],
  );
  await client.query(
    `INSERT INTO organizations (id,name,status) VALUES ($1,'Phase 6 validation','active')`,
    [organization],
  );
  await client.query(
    `INSERT INTO projects (
       id,organization_id,name,description,status,priority,lead_user_id,start_date,due_date,created_by_user_id
     ) VALUES ($1,$2,'Phase 6 project','Validation','planning','medium',$3,'2026-07-01','2026-09-30',$3)`,
    [project, organization, requester],
  );
  const standalone = await client.query(
    `INSERT INTO tickets (requester_user_id,type,subject,description)
     VALUES ($1,'incident','Standalone','Private') RETURNING id,code`,
    [requester],
  );
  const standaloneId = standalone.rows[0].id;
  if (!/^TCK-\d{4}-\d{6,}$/.test(standalone.rows[0].code)) {
    throw new Error("GENERATED_TICKET_CODE_INVALID");
  }
  await client.query(
    `INSERT INTO ticket_comments (ticket_id,organization_id,author_user_id,visibility,content)
     VALUES ($1,$2,$3,'client','Derived standalone organization')`,
    [standaloneId, organization, requester],
  );
  const derived = await client.query(
    "SELECT organization_id FROM ticket_comments WHERE ticket_id=$1",
    [standaloneId],
  );
  if (derived.rows[0]?.organization_id !== null) throw new Error("COMMENT_ORGANIZATION_NOT_DERIVED");
  await expectFailure(
    `INSERT INTO tickets (organization_id,project_id,requester_user_id,type,subject,description)
     VALUES (NULL,$1,$2,'incident','Invalid project context','Invalid')`,
    [project, requester],
    "23514",
  );
  await expectFailure(
    `INSERT INTO ticket_comments (ticket_id,author_user_id,visibility,content)
     VALUES ($1,$2,'client','Orphan')`,
    ["62000000-0000-4000-8000-000000000999", requester],
    "23503",
  );

  let rollbackGuarded = false;
  try {
    await applySql(rollbackPath);
  } catch {
    rollbackGuarded = true;
  }
  if (!rollbackGuarded) throw new Error("PHASE6_ROLLBACK_GUARD_MISSING");

  await client.query("DELETE FROM ticket_comments WHERE ticket_id=$1", [standaloneId]);
  await client.query("DELETE FROM tickets WHERE id=$1", [standaloneId]);
  await applySql(rollbackPath);
  const rolledBack = await catalog(schema);
  const expectedRolledBack = {
    tables: 19,
    columns: 208,
    fks: 45,
    checks: 59,
    uniques: 16,
    explicit_indexes: 56,
  };
  if (JSON.stringify(rolledBack) !== JSON.stringify(expectedRolledBack)) {
    throw new Error(`PHASE6_ROLLBACK_MISMATCH ${JSON.stringify(rolledBack)}`);
  }

  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
  await client.query(`DROP SCHEMA ${quote(historySchema)} CASCADE`);
  const publicAfter = await publicFingerprint();
  if (JSON.stringify(publicBefore) !== JSON.stringify(publicAfter)) throw new Error("PUBLIC_CHANGED");
  console.log(JSON.stringify({
    ok: true,
    baselineHash: actualHash,
    migrated,
    rbacAfter: { roles: 11, permissions: 39, associations: 165 },
    generatedTicketCode: true,
    standaloneTicket: true,
    commentParentIntegrity: true,
    projectTenantIntegrity: true,
    rollbackGuarded: true,
    secondMigrateNoop: true,
    rolledBack,
    publicUnchanged: true,
    cleanup: true,
  }, null, 2));
} finally {
  if (!client.ended) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`).catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${quote(historySchema)} CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
