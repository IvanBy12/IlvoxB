import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";

const sqlPath = process.argv[2];

if (!sqlPath) {
  console.error("Usage: node scripts/audit-sql.mjs <sql-file>");
  process.exitCode = 2;
} else {
  const bytes = await readFile(resolve(sqlPath));
  const sql = bytes.toString("utf8");
  const all = (pattern) => [...sql.matchAll(pattern)];
  const duplicateValues = (values) =>
    [...Map.groupBy(values, (value) => value).entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([value, matches]) => ({ value, count: matches.length }));

  const tableMatches = all(/^CREATE TABLE\s+([a-z_][a-z0-9_]*)\s*\(/gim);
  const tables = tableMatches.map((match) => match[1]);
  const tablePosition = new Map(tableMatches.map((match) => [match[1], match.index]));
  const forwardReferences = [];
  const unknownReferences = [];

  for (let index = 0; index < tableMatches.length; index += 1) {
    const table = tableMatches[index][1];
    const start = tableMatches[index].index;
    const end = tableMatches[index + 1]?.index ?? sql.length;
    const block = sql.slice(start, end);
    for (const reference of block.matchAll(/REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
      const target = reference[1];
      if (!tablePosition.has(target)) {
        unknownReferences.push({ table, target });
      } else if (tablePosition.get(target) > start) {
        forwardReferences.push({ table, target });
      }
    }
  }

  const indexes = all(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z_][a-z0-9_]*)/gim).map(
    (match) => match[1],
  );
  const constraints = all(/\bCONSTRAINT\s+([a-z_][a-z0-9_]*)/gim).map(
    (match) => match[1],
  );

  const result = {
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    bytes: bytes.length,
    beginStatements: all(/^BEGIN;/gim).length,
    commitStatements: all(/^COMMIT;/gim).length,
    extensions: all(/^CREATE EXTENSION IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gim).map(
      (match) => match[1],
    ),
    tables,
    tableCount: tables.length,
    indexCount: indexes.length,
    foreignKeyReferenceCount: all(/\bREFERENCES\s+[a-z_][a-z0-9_]*\s*\(/gim).length,
    checkCount: all(/\bCHECK\s*\(/gim).length,
    namedConstraintCount: constraints.length,
    explicitOnDeleteRestrict: all(/ON DELETE RESTRICT/gim).length,
    explicitOnDeleteCascade: all(/ON DELETE CASCADE/gim).length,
    explicitOnUpdateActions: all(/ON UPDATE\s+(?:RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)/gim)
      .length,
    identityColumns: all(/GENERATED ALWAYS AS IDENTITY/gim).length,
    storedGeneratedColumns: all(/GENERATED ALWAYS AS\s*\([\s\S]*?\)\s*STORED/gim).length,
    createTypeStatements: all(/^CREATE TYPE\s+/gim).length,
    duplicateTables: duplicateValues(tables),
    duplicateIndexes: duplicateValues(indexes),
    duplicateNamedConstraints: duplicateValues(constraints),
    forwardReferences,
    unknownReferences,
  };

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const client = new pg.Client({ connectionString });
    let currentDatabase;
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      currentDatabase = (await client.query(`
        SELECT
          (SELECT count(*)::integer FROM information_schema.tables
           WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
          (SELECT count(*)::integer FROM information_schema.columns
           WHERE table_schema='public') AS columns,
          (SELECT count(*)::integer FROM pg_constraint c JOIN pg_namespace n
           ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f') AS foreign_keys,
          (SELECT count(*)::integer FROM pg_constraint c JOIN pg_namespace n
           ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='c') AS checks,
          (SELECT count(*)::integer FROM pg_constraint c JOIN pg_namespace n
           ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='u') AS unique_constraints,
          (SELECT count(*)::integer FROM pg_indexes
           WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'
             AND indexname NOT IN (
               SELECT conname FROM pg_constraint c JOIN pg_namespace n
               ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='u'
             )) AS explicit_indexes
      `)).rows[0];
      await client.query("ROLLBACK");
    } finally {
      await client.end().catch(() => undefined);
    }
    const currentOk =
      currentDatabase.tables === 19 &&
      currentDatabase.columns === 204 &&
      currentDatabase.foreign_keys === 43 &&
      currentDatabase.checks === 57 &&
      currentDatabase.unique_constraints === 15 &&
      currentDatabase.explicit_indexes === 54;
    console.log(JSON.stringify({ sourceSql: result, currentDatabase, currentOk }, null, 2));
    if (!currentOk) process.exitCode = 1;
  }
}
