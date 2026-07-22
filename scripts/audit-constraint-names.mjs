import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL_MISSING");
  process.exit(2);
}

const drizzle = spawnSync(process.execPath, [resolve("node_modules", "drizzle-kit", "bin.cjs"), "export", "--config", "drizzle.config.ts"], { encoding: "utf8" });
if (drizzle.status !== 0) {
  process.stderr.write(drizzle.stderr);
  process.exit(drizzle.status ?? 1);
}

const exportedForeignKeys = [...drizzle.stdout.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g)].map((match) => match[1]);
const exportedUniques = [...drizzle.stdout.matchAll(/CONSTRAINT "([^"]+)" UNIQUE\(/g)].map((match) => match[1]);
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const constraints = await client.query(`
    SELECT c.contype, c.conname
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.contype IN ('f', 'u')
    ORDER BY c.contype, c.conname
  `);
  const duplicateIndexes = await client.query(`
    SELECT array_agg(indexrelid::regclass::text ORDER BY indexrelid::regclass::text) AS index_names
    FROM pg_index
    WHERE indrelid IN (
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    )
    GROUP BY indrelid, indkey, indexprs, indpred, indisunique
    HAVING count(*) > 1
  `);
  const state = await client.query(`
    SELECT
      (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::integer AS tables,
      (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public')::integer AS columns,
      (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' AND c.contype = 'c')::integer AS checks,
      (SELECT count(*) FROM permissions)::integer AS permissions,
      (SELECT count(*) FROM role_permissions)::integer AS associations,
      (SELECT count(*) FROM pg_namespace
       WHERE nspname LIKE 'ilvox_validation_20260722_%')::integer AS validation_schemas
  `);
  const actualForeignKeys = constraints.rows.filter((row) => row.contype === "f").map((row) => row.conname);
  const actualUniques = constraints.rows.filter((row) => row.contype === "u").map((row) => row.conname);
  const compare = (actual, mapped) => ({
    actual: actual.length,
    mapped: mapped.length,
    missingInDrizzle: actual.filter((name) => !mapped.includes(name)),
    extraInDrizzle: mapped.filter((name) => !actual.includes(name)),
  });
  const result = {
    catalog: state.rows[0],
    foreignKeys: compare(actualForeignKeys, exportedForeignKeys),
    uniqueConstraints: compare(actualUniques, exportedUniques),
    duplicatePhysicalIndexes: duplicateIndexes.rows.map((row) => row.index_names),
  };
  const ok =
    result.catalog.tables === 19 && result.catalog.columns === 199 && result.catalog.checks === 55 &&
    result.catalog.permissions === 23 && result.catalog.associations === 142 &&
    result.catalog.validation_schemas === 0 &&
    result.foreignKeys.actual === 43 && result.foreignKeys.mapped === 43 &&
    result.foreignKeys.missingInDrizzle.length === 0 && result.foreignKeys.extraInDrizzle.length === 0 &&
    result.uniqueConstraints.actual === 15 && result.uniqueConstraints.mapped === 15 &&
    result.uniqueConstraints.missingInDrizzle.length === 0 && result.uniqueConstraints.extraInDrizzle.length === 0 &&
    result.duplicatePhysicalIndexes.length === 0;
  console.log(JSON.stringify({ ok, ...result }, null, 2));
  await client.query("ROLLBACK");
  if (!ok) process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
