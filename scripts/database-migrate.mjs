import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import "dotenv/config";

const BASELINE_PATH = resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql");
const MIGRATIONS_FOLDER = resolve("drizzle", "migrations");
const META_FOLDER = resolve(MIGRATIONS_FOLDER, "meta");
const EXPECTED_BASELINE_HASH = "46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6";
const EXPECTED_TERMINAL_TAG = "0014_phase8f1-email-notifications";
const MIGRATION_LOCK = "ilvox:database:migrate";
const connectionString = process.env.DATABASE_URL;
const bootstrapArgument = process.argv.find((argument) => argument.startsWith("--bootstrap-empty="));
const bootstrapDatabase = bootstrapArgument?.slice("--bootstrap-empty=".length);

if (connectionString === undefined || connectionString.trim() === "") {
  throw new Error("DATABASE_URL_MISSING");
}
if (bootstrapArgument !== undefined && (bootstrapDatabase === undefined || !/^[A-Za-z0-9_-]+$/.test(bootstrapDatabase))) {
  throw new Error("INVALID_BOOTSTRAP_DATABASE use --bootstrap-empty=<exact_database_name>");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

function postgresIdentifier(name) {
  const bytes = Buffer.from(name, "utf8");
  if (bytes.length <= 63) return name;
  let length = 63;
  while ((bytes[length] & 0b1100_0000) === 0b1000_0000) length -= 1;
  return bytes.subarray(0, length).toString("utf8");
}

function snapshotFingerprint(snapshot) {
  const tables = Object.entries(snapshot.tables)
    .filter(([key, table]) => key.startsWith("public.") || table.schema === "" || table.schema === "public")
    .map(([, table]) => table);
  return {
    tables: sorted(tables.map((table) => table.name)),
    columns: sorted(tables.flatMap((table) =>
      Object.keys(table.columns).map((column) => `${table.name}.${column}`))),
    checks: sorted(tables.flatMap((table) =>
      Object.keys(table.checkConstraints).map((name) => `${table.name}.${postgresIdentifier(name)}`))),
    foreignKeys: sorted(tables.flatMap((table) =>
      Object.keys(table.foreignKeys).map((name) => `${table.name}.${postgresIdentifier(name)}`))),
    uniqueConstraints: sorted(tables.flatMap((table) =>
      Object.keys(table.uniqueConstraints).map((name) => `${table.name}.${postgresIdentifier(name)}`))),
    indexes: sorted(tables.flatMap((table) =>
      Object.keys(table.indexes).map((name) => `${table.name}.${postgresIdentifier(name)}`))),
  };
}

const baselineSql = readFileSync(BASELINE_PATH, "utf8");
const journal = JSON.parse(readFileSync(resolve(META_FOLDER, "_journal.json"), "utf8"));
const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
const sqlFiles = readdirSync(MIGRATIONS_FOLDER)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
const snapshotFiles = readdirSync(META_FOLDER)
  .filter((name) => /^\d{4}_snapshot\.json$/u.test(name))
  .sort();

if (sha256(baselineSql).toUpperCase() !== EXPECTED_BASELINE_HASH) {
  throw new Error("BASELINE_HASH_MISMATCH");
}
if (
  journal.entries.length !== migrations.length ||
  journal.entries.length !== sqlFiles.length ||
  journal.entries.length !== snapshotFiles.length
) {
  throw new Error(
    `MIGRATION_SET_MISMATCH journal=${journal.entries.length} migrations=${migrations.length} sql=${sqlFiles.length} snapshots=${snapshotFiles.length}`,
  );
}
if (journal.entries.at(-1)?.tag !== EXPECTED_TERMINAL_TAG) {
  throw new Error(`UNEXPECTED_TERMINAL_MIGRATION ${journal.entries.at(-1)?.tag ?? "missing"}`);
}

const entries = journal.entries.map((entry, index) => ({
  id: index + 1,
  tag: entry.tag,
  hash: migrations[index]?.hash,
  createdAt: String(entry.when),
  sqlPath: resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
}));
const snapshots = snapshotFiles.map((name) => JSON.parse(readFileSync(resolve(META_FOLDER, name), "utf8")));

let previousSnapshotId = "00000000-0000-0000-0000-000000000000";
for (const [index, entry] of entries.entries()) {
  if (`${entry.tag}.sql` !== sqlFiles[index] || entry.hash === undefined || entry.hash.length !== 64) {
    throw new Error(`MIGRATION_CHAIN_MISMATCH index=${index} tag=${entry.tag}`);
  }
  const snapshot = snapshots[index];
  if (snapshot.prevId !== previousSnapshotId) {
    throw new Error(`SNAPSHOT_CHAIN_MISMATCH index=${index} tag=${entry.tag}`);
  }
  previousSnapshotId = snapshot.id;
}

const prohibitedSql = /^(?:\s*)(?:DROP\s+DATABASE|DROP\s+SCHEMA|DROP\s+TABLE|TRUNCATE\b)/imu;
for (const [label, sql] of [
  ["baseline", baselineSql],
  ...entries.slice(1).map((entry) => [entry.tag, readFileSync(entry.sqlPath, "utf8")]),
]) {
  const withoutLineComments = sql.replaceAll(/--.*$/gmu, "");
  if (prohibitedSql.test(withoutLineComments)) throw new Error(`PROHIBITED_SQL ${label}`);
}

function expectedHistory(count) {
  return entries.slice(0, count).map(({ id, hash, createdAt }) => ({ id, hash, createdAt }));
}

function expectedRbac(migrationIndex) {
  if (migrationIndex === 0) return { roles: 11, permissions: 23, associations: 142, distinctAssociations: 142 };
  if (migrationIndex < 5) return { roles: 11, permissions: 36, associations: 157, distinctAssociations: 157 };
  if (migrationIndex < 8) return { roles: 11, permissions: 37, associations: 159, distinctAssociations: 159 };
  return { roles: 11, permissions: 39, associations: 165, distinctAssociations: 165 };
}

async function identity(client) {
  return (await client.query(`
    SELECT current_database() AS database,
           current_schema() AS schema,
           current_setting('server_version') AS version,
           current_setting('server_version_num')::integer AS version_num,
           pg_is_in_recovery() AS recovery,
           current_setting('transaction_read_only') AS transaction_read_only
  `)).rows[0];
}

async function publicRelationCount(client) {
  return (await client.query(`
    SELECT count(*)::integer AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
  `)).rows[0].count;
}

async function actualFingerprint(client) {
  const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name
    `);
  const columns = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, ordinal_position
    `);
  const constraints = await client.query(`
      SELECT t.relname AS table_name, c.contype, c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND c.contype IN ('c','f','u')
      ORDER BY t.relname, c.contype, c.conname
    `);
  const indexes = await client.query(`
      SELECT tablename, indexname FROM pg_indexes i
      WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid=c.connamespace
          WHERE n.nspname='public' AND c.contype='u' AND c.conname=i.indexname
        )
      ORDER BY tablename, indexname
    `);
  const constraintNames = (type) => sorted(constraints.rows
    .filter((constraint) => constraint.contype === type)
    .map((constraint) => `${constraint.table_name}.${constraint.conname}`));
  return {
    tables: sorted(tables.rows.map((table) => table.table_name)),
    columns: sorted(columns.rows.map((column) => `${column.table_name}.${column.column_name}`)),
    checks: constraintNames("c"),
    foreignKeys: constraintNames("f"),
    uniqueConstraints: constraintNames("u"),
    indexes: sorted(indexes.rows.map((index) => `${index.tablename}.${index.indexname}`)),
  };
}

async function rbacState(client) {
  return (await client.query(`
    SELECT
      (SELECT count(*)::integer FROM public.roles) AS roles,
      (SELECT count(*)::integer FROM public.permissions) AS permissions,
      (SELECT count(*)::integer FROM public.role_permissions) AS associations,
      (SELECT count(*)::integer FROM (
        SELECT DISTINCT role_id, permission_id FROM public.role_permissions
      ) d) AS "distinctAssociations"
  `)).rows[0];
}

async function assertSchemaState(client, migrationIndex, label) {
  assertEqual(await actualFingerprint(client), snapshotFingerprint(snapshots[migrationIndex]), `${label}_SCHEMA`);
  assertEqual(await rbacState(client), expectedRbac(migrationIndex), `${label}_RBAC`);
}

async function historyRows(client) {
  const relation = (await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation",
  )).rows[0].relation;
  if (relation === null) return null;
  return (await client.query(`
    SELECT id, hash, created_at::text AS "createdAt"
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `)).rows;
}

async function verifyHistoryTable(client) {
  const columns = (await client.query(`
    SELECT column_name, data_type, is_nullable, column_default IS NOT NULL AS has_default
    FROM information_schema.columns
    WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'
    ORDER BY ordinal_position
  `)).rows;
  assertEqual(columns, [
    { column_name: "id", data_type: "integer", is_nullable: "NO", has_default: true },
    { column_name: "hash", data_type: "text", is_nullable: "NO", has_default: false },
    { column_name: "created_at", data_type: "bigint", is_nullable: "YES", has_default: false },
  ], "HISTORY_TABLE_COLUMNS");
}

async function recognizeBaseline(client) {
  await client.query("BEGIN");
  try {
    await client.query("CREATE SCHEMA drizzle");
    await client.query(`
      CREATE TABLE drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    await client.query(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
      [entries[0].hash, entries[0].createdAt],
    );
    await verifyHistoryTable(client);
    assertEqual(await historyRows(client), expectedHistory(1), "BASELINE_HISTORY");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

const client = new pg.Client({ connectionString });
let locked = false;

try {
  await client.connect();
  const databaseIdentity = await identity(client);
  if (
    Math.floor(databaseIdentity.version_num / 10_000) !== 18 ||
    databaseIdentity.schema !== "public" ||
    databaseIdentity.recovery !== false ||
    databaseIdentity.transaction_read_only !== "off"
  ) {
    throw new Error(`UNSUPPORTED_DATABASE ${JSON.stringify(databaseIdentity)}`);
  }
  if (bootstrapDatabase !== undefined && bootstrapDatabase !== databaseIdentity.database) {
    throw new Error(`BOOTSTRAP_DATABASE_MISMATCH expected=${bootstrapDatabase} actual=${databaseIdentity.database}`);
  }

  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [MIGRATION_LOCK]);
  locked = true;

  let history = await historyRows(client);
  let baselineApplied = false;
  let baselineRecognized = false;

  if (history === null) {
    const relationCount = await publicRelationCount(client);
    if (relationCount === 0) {
      if (bootstrapDatabase === undefined) {
        throw new Error(
          `EMPTY_DATABASE_BOOTSTRAP_CONFIRMATION_REQUIRED use --bootstrap-empty=${databaseIdentity.database}`,
        );
      }
      await client.query(baselineSql);
      await assertSchemaState(client, 0, "BOOTSTRAP_BASELINE");
      baselineApplied = true;
    } else {
      if (bootstrapDatabase !== undefined) {
        throw new Error(`BOOTSTRAP_TARGET_NOT_EMPTY relations=${relationCount}`);
      }
      await assertSchemaState(client, 0, "UNTRACKED_BASELINE");
    }
    await recognizeBaseline(client);
    baselineRecognized = true;
    history = await historyRows(client);
  }

  await verifyHistoryTable(client);
  if (history.length < 1 || history.length > entries.length) {
    throw new Error(`UNEXPECTED_HISTORY_LENGTH ${history.length}`);
  }
  assertEqual(history, expectedHistory(history.length), "HISTORY_PREFIX");
  await assertSchemaState(client, history.length - 1, "PRE_MIGRATION");

  const pending = entries.slice(history.length).map((entry) => entry.tag);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const finalHistory = await historyRows(client);
  assertEqual(finalHistory, expectedHistory(entries.length), "FINAL_HISTORY");
  await assertSchemaState(client, entries.length - 1, "FINAL");

  console.log(JSON.stringify({
    ok: true,
    database: databaseIdentity.database,
    schema: databaseIdentity.schema,
    postgresql: databaseIdentity.version,
    baselineApplied,
    baselineRecognized,
    applied: pending,
    terminalMigration: entries.at(-1).tag,
    historyCount: finalHistory.length,
    pending: [],
    catalog: Object.fromEntries(
      Object.entries(snapshotFingerprint(snapshots.at(-1))).map(([key, values]) => [key, values.length]),
    ),
    rbac: await rbacState(client),
  }, null, 2));
} finally {
  if (locked) {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [MIGRATION_LOCK])
      .catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
