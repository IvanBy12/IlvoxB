import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import "dotenv/config";

const command = process.argv[2] ?? "inspect";
const connectionString = process.env.DATABASE_URL;
const migrationsFolder = resolve("drizzle", "migrations");
const journal = JSON.parse(
  readFileSync(resolve(migrationsFolder, "meta", "_journal.json"), "utf8"),
);
const migrations = readMigrationFiles({ migrationsFolder });
const expectedMigrationHash =
  "98903f835896224c59767e2723eb0cf2b13d2dd2f2c67dc4dc4cc1aef1945cd6";
const expectedBeforeCatalog = {
  tables: 19,
  columns: 208,
  fks: 45,
  checks: 59,
  uniques: 16,
  explicitIndexes: 56,
};
const expectedAfterCatalog = {
  tables: 19,
  columns: 208,
  fks: 47,
  checks: 60,
  uniques: 16,
  explicitIndexes: 58,
};
const expectedBeforeRbac = {
  roles: 11,
  permissions: 37,
  associations: 159,
  distinctAssociations: 159,
};
const expectedAfterRbac = {
  roles: 11,
  permissions: 39,
  associations: 165,
  distinctAssociations: 165,
};

if (connectionString === undefined || connectionString.trim() === "") {
  throw new Error("DATABASE_URL_MISSING");
}
if (!["inspect", "migrate"].includes(command)) {
  throw new Error("USAGE node scripts/phase6-operational-deploy.mjs <inspect|migrate>");
}
if (journal.entries.length !== 9 || migrations.length !== 9) {
  throw new Error(
    `MIGRATION_SET_MISMATCH journal=${journal.entries.length} files=${migrations.length}`,
  );
}

const entries = journal.entries.map((entry, index) => ({
  id: index + 1,
  tag: entry.tag,
  hash: migrations[index]?.hash,
  createdAt: String(entry.when),
}));
if (
  entries[8]?.tag !== "0008_phase6-tickets" ||
  entries[8]?.hash !== expectedMigrationHash
) {
  throw new Error("MIGRATION_0008_HASH_OR_JOURNAL_MISMATCH");
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
}

async function identity(client) {
  const result = await client.query(`
    SELECT current_database() AS database,
           current_schema() AS schema,
           current_setting('server_version') AS version,
           pg_is_in_recovery() AS recovery,
           inet_server_addr()::text AS host
  `);
  return result.rows[0];
}

async function history(client) {
  const result = await client.query(`
    SELECT id, hash, created_at::text AS "createdAt"
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `);
  return result.rows;
}

async function catalog(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::integer FROM information_schema.columns
       WHERE table_schema='public') AS columns,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname='public' AND c.contype='f') AS fks,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname='public' AND c.contype='c') AS checks,
      (SELECT count(*)::integer FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname='public' AND c.contype='u') AS uniques,
      (SELECT count(*)::integer FROM pg_indexes
       WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'
         AND indexname NOT IN (
           SELECT conname FROM pg_constraint c
           JOIN pg_namespace n ON n.oid=c.connamespace
           WHERE n.nspname='public' AND c.contype='u'
         )) AS "explicitIndexes"
  `);
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

function expectedHistory(count) {
  return entries.slice(0, count).map(({ id, hash, createdAt }) => ({
    id,
    hash,
    createdAt,
  }));
}

const client = new pg.Client({ connectionString });
await client.connect();
let locked = false;

try {
  const databaseIdentity = await identity(client);
  if (
    databaseIdentity.database !== "GestionIlvox" ||
    databaseIdentity.schema !== "public" ||
    databaseIdentity.version !== "18.4" ||
    databaseIdentity.recovery !== false ||
    !["127.0.0.1/32", "::1/128"].includes(databaseIdentity.host)
  ) {
    throw new Error(`DATABASE_IDENTITY_MISMATCH ${JSON.stringify(databaseIdentity)}`);
  }

  const beforeHistory = await history(client);
  const beforeCatalog = await catalog(client);
  const beforeRbac = await rbac(client);
  const beforeCount = beforeHistory.length;
  if (![8, 9].includes(beforeCount)) {
    throw new Error(`UNEXPECTED_HISTORY_COUNT ${beforeCount}`);
  }
  assertEqual(beforeHistory, expectedHistory(beforeCount), "HISTORY_BEFORE");
  assertEqual(
    beforeCatalog,
    beforeCount === 8 ? expectedBeforeCatalog : expectedAfterCatalog,
    "CATALOG_BEFORE",
  );
  assertEqual(
    beforeRbac,
    beforeCount === 8 ? expectedBeforeRbac : expectedAfterRbac,
    "RBAC_BEFORE",
  );

  if (command === "inspect") {
    console.log(JSON.stringify({
      ok: true,
      command,
      identity: databaseIdentity,
      history: beforeHistory.map((row, index) => ({
        ...row,
        tag: entries[index]?.tag,
      })),
      pending: entries.slice(beforeCount).map((entry) => entry.tag),
      catalog: beforeCatalog,
      rbac: beforeRbac,
    }, null, 2));
    process.exitCode = 0;
  } else {
    if (beforeCount !== 8) {
      throw new Error("MIGRATION_0008_NOT_EXACTLY_PENDING");
    }
    assertEqual(
      entries.slice(beforeCount).map((entry) => entry.tag),
      ["0008_phase6-tickets"],
      "PENDING_MIGRATIONS",
    );

    await client.query(
      "SELECT pg_advisory_lock(hashtext('ilvox:phase6:operational-migrate'))",
    );
    locked = true;
    const database = drizzle(client);
    await migrate(database, { migrationsFolder });

    const afterFirstHistory = await history(client);
    const afterFirstCatalog = await catalog(client);
    const afterFirstRbac = await rbac(client);
    assertEqual(afterFirstHistory, expectedHistory(9), "HISTORY_AFTER_FIRST");
    assertEqual(afterFirstCatalog, expectedAfterCatalog, "CATALOG_AFTER_FIRST");
    assertEqual(afterFirstRbac, expectedAfterRbac, "RBAC_AFTER_FIRST");

    await migrate(database, { migrationsFolder });

    const afterSecondHistory = await history(client);
    const afterSecondCatalog = await catalog(client);
    const afterSecondRbac = await rbac(client);
    assertEqual(afterSecondHistory, afterFirstHistory, "SECOND_MIGRATE_HISTORY");
    assertEqual(afterSecondCatalog, afterFirstCatalog, "SECOND_MIGRATE_CATALOG");
    assertEqual(afterSecondRbac, afterFirstRbac, "SECOND_MIGRATE_RBAC");

    console.log(JSON.stringify({
      ok: true,
      command,
      applied: ["0008_phase6-tickets"],
      history: afterSecondHistory.map((row, index) => ({
        ...row,
        tag: entries[index]?.tag,
      })),
      pending: [],
      catalog: afterSecondCatalog,
      rbac: afterSecondRbac,
      secondMigrateNoop: true,
    }, null, 2));
  }
} finally {
  if (locked) {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('ilvox:phase6:operational-migrate'))",
    ).catch(() => undefined);
  }
  await client.end();
}
