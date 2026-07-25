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

const migrations = [
  "0001_phase3-rbac-separation.sql",
  "0002_phase3-file-audience.sql",
  "0003_phase3-clerk-event-idempotency.sql",
  "0004_phase4-5-lead-standalone-conversion.sql",
  "0005_phase4-5-services-manage.sql",
  "0006_phase5-member-revocation.sql",
  "0007_phase5-deliverable-milestone.sql",
];
const rollbackMember = resolve(
  "drizzle",
  "rollbacks",
  "0006_phase5-member-revocation.down.sql",
);
const rollbackDeliverable = resolve(
  "drizzle",
  "rollbacks",
  "0007_phase5-deliverable-milestone.down.sql",
);
const schema = `ilvox_phase5_closure_${randomBytes(6).toString("hex")}`;
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

async function applySql(path, transaction = false) {
  if (transaction) await client.query("BEGIN");
  try {
    await client.query(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
    if (transaction) await client.query("COMMIT");
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function expectSqlFailure(sql, values, expectedCode) {
  let failed = false;
  await client.query("BEGIN");
  try {
    await client.query(sql, values);
  } catch (error) {
    failed = error?.code === expectedCode;
  } finally {
    await client.query("ROLLBACK");
  }
  if (!failed) throw new Error(`EXPECTED_SQL_FAILURE_${expectedCode}`);
}

async function expectRollbackGuard(path) {
  let guarded = false;
  try {
    await applySql(path);
  } catch {
    guarded = true;
    await client.query("ROLLBACK").catch(() => undefined);
  }
  if (!guarded) throw new Error(`ROLLBACK_GUARD_MISSING_${path}`);
}

try {
  await client.connect();
  const publicBefore = await publicFingerprint();
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET search_path TO ${quote(schema)}, public`);
  await client.query(baseline);
  for (const migration of migrations) {
    await applySql(
      resolve("drizzle", "migrations", migration),
      migration.startsWith("0006_") || migration.startsWith("0007_"),
    );
  }

  const migratedCatalog = await catalog(schema);
  const expectedMigrated = {
    tables: 19,
    columns: 208,
    fks: 45,
    checks: 59,
    uniques: 16,
    explicit_indexes: 56,
  };
  if (JSON.stringify(migratedCatalog) !== JSON.stringify(expectedMigrated)) {
    throw new Error(`PHASE5_CLOSURE_CATALOG_MISMATCH ${JSON.stringify(migratedCatalog)}`);
  }

  const artifacts = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM information_schema.columns
       WHERE table_schema=$1 AND table_name='project_members'
         AND column_name IN ('status','revoked_at','revoked_by_user_id')) AS member_columns,
      (SELECT count(*)::integer FROM information_schema.columns
       WHERE table_schema=$1 AND table_name='deliverables'
         AND column_name='milestone_id' AND is_nullable='YES') AS milestone_column,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=$1 AND c.convalidated
         AND c.conname IN (
           'project_members_revoked_by_user_id_fkey',
           'chk_project_members_status',
           'chk_project_members_revocation',
           'fk_deliverables_milestone_project',
           'uq_project_milestones_id_project_organization'
         )) AS validated_constraints,
      (SELECT count(*)::integer FROM pg_indexes
       WHERE schemaname=$1
         AND indexname IN ('idx_project_members_active_user','idx_deliverables_milestone')) AS indexes
  `, [schema]);
  if (JSON.stringify(artifacts.rows[0]) !== JSON.stringify({
    member_columns: 3,
    milestone_column: 1,
    validated_constraints: 5,
    indexes: 2,
  })) {
    throw new Error(`PHASE5_CLOSURE_ARTIFACT_MISMATCH ${JSON.stringify(artifacts.rows[0])}`);
  }

  const actor = "51000000-0000-4000-8000-000000000001";
  const member = "51000000-0000-4000-8000-000000000002";
  const organization = "51000000-0000-4000-8000-000000000101";
  const projectA = "51000000-0000-4000-8000-000000000201";
  const projectB = "51000000-0000-4000-8000-000000000202";
  const milestone = "51000000-0000-4000-8000-000000000301";
  const deliverable = "51000000-0000-4000-8000-000000000401";
  await client.query(
    `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
     ($1,'closure_validator_actor','closure-validator-actor@example.test','active'),
     ($2,'closure_validator_member','closure-validator-member@example.test','active')`,
    [actor, member],
  );
  await client.query(
    `INSERT INTO organizations (id,name,status)
     VALUES ($1,'Closure migration validation','active')`,
    [organization],
  );
  await client.query(
    `INSERT INTO projects (
       id,organization_id,name,description,status,priority,lead_user_id,start_date,due_date,created_by_user_id
     ) VALUES
     ($1,$3,'Closure project A','Migration validation A','planning','medium',$4,'2026-07-01','2026-09-30',$4),
     ($2,$3,'Closure project B','Migration validation B','planning','medium',$4,'2026-07-01','2026-09-30',$4)`,
    [projectA, projectB, organization, actor],
  );
  await client.query(
    `INSERT INTO project_members (
       project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
     )
     SELECT $1,$2,$3,id,'project',$4
     FROM roles WHERE scope='project' AND code='project_member'`,
    [projectA, organization, member, actor],
  );
  await client.query(
    `INSERT INTO project_milestones (id,project_id,organization_id,name,status,due_date)
     VALUES ($1,$2,$3,'Validation milestone','pending','2026-08-15')`,
    [milestone, projectA, organization],
  );
  await client.query(
     `INSERT INTO deliverables (
       id,project_id,organization_id,milestone_id,name,status
     ) VALUES ($1,$2,$3,$4,'Validation deliverable','pending')`,
    [deliverable, projectA, organization, milestone],
  );

  await expectSqlFailure(
     `INSERT INTO deliverables (
       project_id,organization_id,milestone_id,name,status
     ) VALUES ($1,$2,$3,'Invalid cross-project link','pending')`,
    [projectB, organization, milestone],
    "23503",
  );

  await client.query(
    `UPDATE project_members
     SET status='revoked', revoked_at=now(), revoked_by_user_id=$1
     WHERE project_id=$2 AND user_id=$3`,
    [actor, projectA, member],
  );
  await expectRollbackGuard(rollbackDeliverable);
  await expectRollbackGuard(rollbackMember);

  await client.query("UPDATE deliverables SET milestone_id=NULL WHERE id=$1", [deliverable]);
  await applySql(rollbackDeliverable);
  await client.query(
    `UPDATE project_members
     SET status='active', revoked_at=NULL, revoked_by_user_id=NULL
     WHERE project_id=$1 AND user_id=$2`,
    [projectA, member],
  );
  await applySql(rollbackMember);

  const rolledBackCatalog = await catalog(schema);
  const expectedRolledBack = {
    tables: 19,
    columns: 204,
    fks: 43,
    checks: 57,
    uniques: 15,
    explicit_indexes: 54,
  };
  if (JSON.stringify(rolledBackCatalog) !== JSON.stringify(expectedRolledBack)) {
    throw new Error(`PHASE5_CLOSURE_ROLLBACK_MISMATCH ${JSON.stringify(rolledBackCatalog)}`);
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
    baselineHash: actualHash,
    migrated: migratedCatalog,
    artifactValidation: true,
    crossProjectForeignKeyRejected: true,
    rollbackGuards: {
      linkedDeliverable: true,
      revokedMember: true,
    },
    rolledBack: rolledBackCatalog,
    publicUnchanged: true,
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
