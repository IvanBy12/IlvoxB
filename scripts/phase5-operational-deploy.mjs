import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import "dotenv/config";

const command = process.argv[2];
const connectionString = process.env.DATABASE_URL;
const migrationsFolder = resolve("drizzle", "migrations");
const journal = JSON.parse(
  readFileSync(resolve(migrationsFolder, "meta", "_journal.json"), "utf8"),
);
const migrations = readMigrationFiles({ migrationsFolder });
const entries = journal.entries.map((entry, index) => ({
  index,
  tag: entry.tag,
  createdAt: entry.when,
  hash: migrations[index]?.hash,
}));
const expectedBefore = {
  tables: 19,
  columns: 204,
  fks: 43,
  checks: 57,
  uniques: 15,
  explicitIndexes: 54,
};
const expectedAfter = {
  tables: 19,
  columns: 208,
  fks: 45,
  checks: 59,
  uniques: 16,
  explicitIndexes: 56,
};
const expectedRbac = {
  roles: 11,
  permissions: 37,
  associations: 159,
  distinctAssociations: 159,
};
const migrationLockName = "ilvox:phase5:drizzle-migrate";
const recognitionLockName = "ilvox:phase5:history-recognition";

if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL_MISSING");
  process.exit(2);
}
if (entries.length !== 8 || migrations.length !== 8) {
  throw new Error(`MIGRATION_SET_MISMATCH journal=${entries.length} files=${migrations.length}`);
}
for (const entry of entries) {
  if (typeof entry.hash !== "string" || entry.hash.length !== 64) {
    throw new Error(`MIGRATION_HASH_MISSING ${entry.tag}`);
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]+$/.test(identifier)) {
    throw new Error(`UNSAFE_IDENTIFIER ${identifier}`);
  }
  return `"${identifier}"`;
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

async function catalog(client, schema = "public") {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM information_schema.tables
       WHERE table_schema=$1 AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::integer FROM information_schema.columns
       WHERE table_schema=$1) AS columns,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=$1 AND c.contype='f') AS fks,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=$1 AND c.contype='c') AS checks,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=$1 AND c.contype='u') AS uniques,
      (SELECT count(*)::integer FROM pg_indexes
       WHERE schemaname=$1 AND indexname NOT LIKE '%_pkey'
         AND indexname NOT IN (
           SELECT conname FROM pg_constraint c
           JOIN pg_namespace n ON n.oid=c.connamespace
           WHERE n.nspname=$1 AND c.contype='u'
         )) AS "explicitIndexes"
  `, [schema]);
  return result.rows[0];
}

async function rbac(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM public.roles) AS roles,
      (SELECT count(*)::integer FROM public.permissions) AS permissions,
      (SELECT count(*)::integer FROM public.role_permissions) AS associations,
      (SELECT count(*)::integer FROM (
        SELECT DISTINCT role_id, permission_id FROM public.role_permissions
      ) d) AS "distinctAssociations"
  `);
  return result.rows[0];
}

async function phase5Artifacts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM information_schema.columns
       WHERE table_schema='public'
         AND (
           (table_name='project_members'
            AND column_name IN ('status','revoked_at','revoked_by_user_id'))
           OR
           (table_name='deliverables' AND column_name='milestone_id')
         )) AS columns,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname='public'
         AND c.conname IN (
           'project_members_revoked_by_user_id_fkey',
           'chk_project_members_status',
           'chk_project_members_revocation',
           'fk_deliverables_milestone_project',
           'uq_project_milestones_id_project_organization'
         )) AS constraints,
      (SELECT count(*)::integer FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN (
           'idx_project_members_active_user',
           'idx_deliverables_milestone'
         )) AS indexes
  `);
  return result.rows[0];
}

async function assertHistoricalEffects(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)=13 FROM public.permissions
       WHERE code IN (
         'tickets.confirm_resolution','tickets.reject_resolution','tickets.request_reopen',
         'organization_members.manage','users.manage_non_privileged','audit.read_scoped',
         'permissions.manage','roles.assign_super_admin','security.manage','system.configure',
         'organizations.access_all','files.read_client','files.upload_client'
       )) AS migration_0001,
      (
        SELECT count(*)=1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='files'
          AND column_name='audience' AND is_nullable='NO'
      ) AND (
        SELECT count(*)=1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_files_organization_audience_active'
      ) AND (
        SELECT count(*)=1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' AND c.conname='chk_files_audience'
      ) AS migration_0002,
      (
        SELECT count(*)=4 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='identity_webhook_events'
          AND column_name IN (
            'clerk_occurred_at','received_at','payload_sha256','last_error_code'
          )
      ) AND (
        SELECT count(*)=1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public'
          AND c.conname='chk_identity_webhook_events_payload_sha256'
      ) AS migration_0003,
      (
        SELECT pg_get_constraintdef(c.oid) ILIKE '%converted_at IS NOT NULL%'
          AND pg_get_constraintdef(c.oid) NOT ILIKE '%converted_organization_id IS NOT NULL%'
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' AND c.conname='chk_leads_conversion'
      ) AS migration_0004,
      (
        SELECT count(*)=1 FROM public.permissions WHERE code='services.manage'
      ) AND (
        SELECT count(*)=2
        FROM public.role_permissions rp
        JOIN public.roles r ON r.id=rp.role_id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE p.code='services.manage' AND r.scope='global'
          AND r.code IN ('super_admin','admin')
      ) AS migration_0005
  `);
  const effects = result.rows[0];
  if (Object.values(effects).some((value) => value !== true)) {
    throw new Error(`HISTORICAL_EFFECT_MISMATCH ${JSON.stringify(effects)}`);
  }
  return effects;
}

async function databaseIdentity(client) {
  const result = await client.query(`
    SELECT current_database() AS database,
           current_schema() AS schema,
           current_user AS username,
           inet_server_addr()::text AS host,
           inet_server_port() AS port,
           current_setting('server_version') AS version,
           pg_is_in_recovery() AS recovery
  `);
  return result.rows[0];
}

async function historyRows(client) {
  const exists = await client.query(
    `SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation`,
  );
  if (exists.rows[0].relation === null) return [];
  const result = await client.query(`
    SELECT id, hash, created_at::text AS "createdAt"
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `);
  return result.rows;
}

function expectedHistory(count) {
  return entries.slice(0, count).map((entry, index) => ({
    id: index + 1,
    hash: entry.hash,
    createdAt: String(entry.createdAt),
  }));
}

async function verifyHistoryTable(client) {
  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable,
           column_default IS NOT NULL AS has_default
    FROM information_schema.columns
    WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'
    ORDER BY ordinal_position
  `);
  assertEqual(columns.rows, [
    { column_name: "id", data_type: "integer", is_nullable: "NO", has_default: true },
    { column_name: "hash", data_type: "text", is_nullable: "NO", has_default: false },
    { column_name: "created_at", data_type: "bigint", is_nullable: "YES", has_default: false },
  ], "HISTORY_TABLE_COLUMNS");
  const constraints = await client.query(`
    SELECT count(*)::integer AS primary_keys
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='drizzle'
      AND c.conrelid='drizzle.__drizzle_migrations'::regclass
      AND c.contype='p'
  `);
  if (constraints.rows[0].primary_keys !== 1) {
    throw new Error("HISTORY_TABLE_PRIMARY_KEY_MISMATCH");
  }
  const sequence = await client.query(`
    SELECT pg_get_serial_sequence(
      'drizzle.__drizzle_migrations',
      'id'
    ) IS NOT NULL AS present
  `);
  if (sequence.rows[0].present !== true) throw new Error("HISTORY_SEQUENCE_MISSING");
}

async function assertPreRecognitionState(client) {
  assertEqual(await catalog(client), expectedBefore, "PRE_RECOGNITION_CATALOG");
  assertEqual(await rbac(client), expectedRbac, "PRE_RECOGNITION_RBAC");
  assertEqual(
    await phase5Artifacts(client),
    { columns: 0, constraints: 0, indexes: 0 },
    "PRE_RECOGNITION_PHASE5_ARTIFACTS",
  );
  await assertHistoricalEffects(client);
  if ((await historyRows(client)).length !== 0) {
    throw new Error("HISTORY_ALREADY_PRESENT");
  }
}

async function recognizeHistory(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [recognitionLockName],
    );
    await assertPreRecognitionState(client);
    await client.query("CREATE SCHEMA drizzle");
    await client.query(`
      CREATE TABLE drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    for (const entry of entries.slice(0, 6)) {
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         VALUES ($1, $2)`,
        [entry.hash, entry.createdAt],
      );
    }
    await verifyHistoryTable(client);
    assertEqual(await historyRows(client), expectedHistory(6), "RECOGNIZED_HISTORY");
    const duplicates = await client.query(`
      SELECT count(*)::integer AS count
      FROM (
        SELECT created_at FROM drizzle.__drizzle_migrations
        GROUP BY created_at HAVING count(*) > 1
      ) d
    `);
    if (duplicates.rows[0].count !== 0) throw new Error("HISTORY_DUPLICATES");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return historyRows(client);
}

async function pendingEntries(client) {
  const history = await historyRows(client);
  const lastCreatedAt = history.length === 0
    ? Number.NEGATIVE_INFINITY
    : Number(history.at(-1).createdAt);
  return entries.filter((entry) => entry.createdAt > lastCreatedAt);
}

async function officialMigrate(client) {
  await client.query(
    "SELECT pg_advisory_lock(hashtextextended($1, 0))",
    [migrationLockName],
  );
  try {
    const pending = await pendingEntries(client);
    assertEqual(
      pending.map((entry) => entry.tag),
      [
        "0006_phase5-member-revocation",
        "0007_phase5-deliverable-milestone",
      ],
      "PENDING_MIGRATIONS",
    );
    const database = drizzle(client);
    await migrate(database, { migrationsFolder });
    assertEqual(await historyRows(client), expectedHistory(8), "MIGRATED_HISTORY");
    assertEqual(await catalog(client), expectedAfter, "MIGRATED_CATALOG");
    assertEqual(await rbac(client), expectedRbac, "MIGRATED_RBAC");

    const historyAfterFirst = await historyRows(client);
    const catalogAfterFirst = await catalog(client);
    await migrate(database, { migrationsFolder });
    assertEqual(await historyRows(client), historyAfterFirst, "SECOND_MIGRATE_HISTORY");
    assertEqual(await catalog(client), catalogAfterFirst, "SECOND_MIGRATE_CATALOG");
    return {
      applied: pending.map((entry) => entry.tag),
      secondMigrateNoop: true,
      history: historyAfterFirst,
      catalog: catalogAfterFirst,
    };
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
      [migrationLockName],
    ).catch(() => undefined);
  }
}

async function postflight(client) {
  assertEqual(await historyRows(client), expectedHistory(8), "POSTFLIGHT_HISTORY");
  assertEqual(await catalog(client), expectedAfter, "POSTFLIGHT_CATALOG");
  assertEqual(await rbac(client), expectedRbac, "POSTFLIGHT_RBAC");
  assertEqual(
    await phase5Artifacts(client),
    { columns: 4, constraints: 5, indexes: 2 },
    "POSTFLIGHT_PHASE5_ARTIFACTS",
  );
  const integrity = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname='public' AND c.convalidated
         AND c.conname IN (
           'project_members_revoked_by_user_id_fkey',
           'chk_project_members_status',
           'chk_project_members_revocation',
           'fk_deliverables_milestone_project',
           'uq_project_milestones_id_project_organization'
         )) AS validated_constraints,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname='public'
         AND c.conname='fk_deliverables_milestone_project'
         AND c.confdeltype='r' AND c.confupdtype='a') AS milestone_fk_actions,
      (SELECT count(*)::integer FROM (
        SELECT indrelid, indkey, indexprs, indpred, indisunique
        FROM pg_index i
        JOIN pg_class t ON t.oid=i.indrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public'
        GROUP BY indrelid, indkey, indexprs, indpred, indisunique
        HAVING count(*) > 1
      ) d) AS duplicate_indexes,
      (SELECT count(*)::integer FROM (
        SELECT conrelid, conname
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public'
        GROUP BY conrelid, conname HAVING count(*) > 1
      ) d) AS duplicate_constraints
  `);
  assertEqual(integrity.rows[0], {
    validated_constraints: 5,
    milestone_fk_actions: 1,
    duplicate_indexes: 0,
    duplicate_constraints: 0,
  }, "POSTFLIGHT_INTEGRITY");
  return {
    history: await historyRows(client),
    catalog: await catalog(client),
    rbac: await rbac(client),
    artifacts: await phase5Artifacts(client),
    integrity: integrity.rows[0],
  };
}

async function assertLocalDevelopment(client) {
  const identity = await databaseIdentity(client);
  const url = new URL(connectionString);
  if (
    identity.database !== "GestionIlvox" ||
    identity.schema !== "public" ||
    identity.version !== "18.4" ||
    identity.recovery !== false ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    (process.env.NODE_ENV ?? "development") === "production"
  ) {
    throw new Error(`UNSAFE_TARGET ${JSON.stringify({
      ...identity,
      environment: process.env.NODE_ENV ?? "development",
      credentialsExposed: false,
    })}`);
  }
  return identity;
}

async function rehearse() {
  const sourceUrl = new URL(connectionString);
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const databaseName = `ilvox_phase5_rehearsal_${randomBytes(6).toString("hex")}`;
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${databaseName}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  let target;
  const notices = [];
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    target = new pg.Client({ connectionString: targetUrl.toString() });
    target.on("notice", (notice) => {
      notices.push({ severity: notice.severity, code: notice.code, message: notice.message });
    });
    await target.connect();
    await target.query(readFileSync(
      resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"),
      "utf8",
    ));
    for (const entry of entries.slice(1, 6)) {
      const sql = readFileSync(
        resolve(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
      ).replaceAll("--> statement-breakpoint", "");
      await target.query(sql);
    }
    await assertPreRecognitionState(target);
    const recognized = await recognizeHistory(target);
    assertEqual(
      (await pendingEntries(target)).map((entry) => entry.tag),
      [
        "0006_phase5-member-revocation",
        "0007_phase5-deliverable-milestone",
      ],
      "REHEARSAL_PENDING",
    );
    const migrated = await officialMigrate(target);
    const final = await postflight(target);

    await target.query(readFileSync(
      resolve("drizzle", "rollbacks", "0007_phase5-deliverable-milestone.down.sql"),
      "utf8",
    ));
    await target.query(readFileSync(
      resolve("drizzle", "rollbacks", "0006_phase5-member-revocation.down.sql"),
      "utf8",
    ));
    assertEqual(await catalog(target), expectedBefore, "REHEARSAL_ROLLBACK_CATALOG");

    return {
      ok: true,
      database: databaseName,
      initialHistoryAbsent: true,
      recognized,
      pendingAfterRecognition: migrated.applied,
      historicalMigrationsRepeated: false,
      migrated,
      final,
      secondMigrateNoop: migrated.secondMigrateNoop,
      rollbacks: ["0007", "0006"],
      rollbackCatalog: await catalog(target),
      notices,
      cleanup: "pending",
    };
  } finally {
    if (target !== undefined) await target.end().catch(() => undefined);
    if (!admin.ended) {
      await admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname=$1 AND pid<>pg_backend_pid()`,
        [databaseName],
      ).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
        .catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  }
}

async function withPublicClient(action) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const identity = await assertLocalDevelopment(client);
    return { identity, result: await action(client) };
  } finally {
    await client.end();
  }
}

let output;
switch (command) {
  case "inspect":
    output = await withPublicClient(async (client) => ({
      history: await historyRows(client),
      pending: (await pendingEntries(client)).map((entry) => entry.tag),
      catalog: await catalog(client),
      rbac: await rbac(client),
      artifacts: await phase5Artifacts(client),
    }));
    break;
  case "rehearse": {
    const rehearsal = await rehearse();
    rehearsal.cleanup = true;
    output = rehearsal;
    break;
  }
  case "recognize-public":
    output = await withPublicClient(async (client) => ({
      history: await recognizeHistory(client),
      pending: (await pendingEntries(client)).map((entry) => entry.tag),
    }));
    break;
  case "migrate-public":
    output = await withPublicClient(async (client) => officialMigrate(client));
    break;
  case "postflight":
    output = await withPublicClient(async (client) => postflight(client));
    break;
  default:
    console.error(
      "Usage: node scripts/phase5-operational-deploy.mjs "
      + "<inspect|rehearse|recognize-public|migrate-public|postflight>",
    );
    process.exit(2);
}

console.log(JSON.stringify({ command, ...output }, null, 2));
