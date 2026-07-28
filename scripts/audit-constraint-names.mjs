import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";
import { buildConstraintAudit } from "./audit-constraint-names.lib.mjs";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL_MISSING");
  process.exit(2);
}

const drizzle = spawnSync(
  process.execPath,
  [resolve("node_modules", "drizzle-kit", "bin.cjs"), "export", "--config", "drizzle.config.ts"],
  { encoding: "utf8" },
);
if (drizzle.status !== 0) {
  process.stderr.write(drizzle.stderr);
  process.exit(drizzle.status ?? 1);
}

const client = new pg.Client({ connectionString });
let result;

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const constraints = await client.query(`
    SELECT c.contype, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.contype IN ('c', 'f', 'u')
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
  const validationSchemas = await client.query(`
    SELECT count(*)::integer AS count
    FROM pg_namespace
    WHERE nspname LIKE 'ilvox_validation_%'
       OR nspname LIKE 'ilvox_phase45_%'
       OR nspname LIKE 'ilvox_phase5_closure_%'
       OR nspname LIKE 'ilvox_phase6_%'
  `);
  result = buildConstraintAudit({
    exportedSql: drizzle.stdout,
    physicalConstraints: constraints.rows,
    duplicatePhysicalIndexes: duplicateIndexes.rows.map((row) => row.index_names),
    validationSchemas: validationSchemas.rows[0].count,
    allowedPendingConstraints: {
      checks: [
        "chk_tickets_project_requires_organization",
      ],
      foreignKeys: [
        "fk_ticket_comments_ticket_id",
        "fk_tickets_project_id",
      ],
      uniqueConstraints: [],
    },
  });
  await client.query("ROLLBACK");
} finally {
  await client.end().catch(() => undefined);
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
