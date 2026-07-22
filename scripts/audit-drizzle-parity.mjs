import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const sqlPath = process.argv[2];
if (sqlPath === undefined) {
  console.error("Usage: node scripts/audit-drizzle-parity.mjs <authoritative-sql-file>");
  process.exit(2);
}

const sourceSql = readFileSync(resolve(sqlPath), "utf8");
const drizzleExecutable = resolve("node_modules", "drizzle-kit", "bin.cjs");
const exported = spawnSync(process.execPath, [drizzleExecutable, "export", "--config", "drizzle.config.ts"], {
  encoding: "utf8",
});

if (exported.status !== 0) {
  process.stderr.write(exported.stderr);
  process.exit(exported.status ?? 1);
}

const drizzleSql = exported.stdout;

function matches(input, expression, group = 1) {
  return [...input.matchAll(expression)].map((match) => match[group]);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function compareNames(label, sourceValues, drizzleValues, allowedPhase3Extras = []) {
  const source = sortedUnique(sourceValues);
  const mapped = sortedUnique(drizzleValues);
  const missing = source.filter((value) => !mapped.includes(value));
  const extra = mapped.filter((value) => !source.includes(value) && !allowedPhase3Extras.includes(value));
  const ok = missing.length === 0 && extra.length === 0;

  console.log(`${label}: source=${source.length}, drizzle=${mapped.length}, match=${ok}`);
  const expectedExtras = mapped.filter((value) => allowedPhase3Extras.includes(value));
  if (expectedExtras.length > 0) console.log(`  expected phase-3 additions: ${expectedExtras.join(", ")}`);
  if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
  if (extra.length > 0) console.log(`  extra: ${extra.join(", ")}`);
  return ok;
}

const comparisons = [
  compareNames(
    "tables",
    matches(sourceSql, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi),
    matches(drizzleSql, /CREATE\s+TABLE\s+"([a-z_][a-z0-9_]*)"/gi),
  ),
  compareNames(
    "explicit indexes",
    matches(sourceSql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z_][a-z0-9_]*)/gi),
    matches(drizzleSql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([a-z_][a-z0-9_]*)"/gi),
    ["idx_files_organization_audience_active"],
  ),
  compareNames(
    "named checks",
    matches(sourceSql, /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\s*\(/gi),
    matches(drizzleSql, /CONSTRAINT\s+"([a-z_][a-z0-9_]*)"\s+CHECK\s*\(/gi),
    ["chk_files_audience", "chk_identity_webhook_events_payload_sha256"],
  ),
  compareNames(
    "named foreign keys",
    matches(sourceSql, /CONSTRAINT\s+(fk_[a-z_][a-z0-9_]*)\s+FOREIGN\s+KEY/gi),
    matches(drizzleSql, /CONSTRAINT\s+"(fk_[a-z_][a-z0-9_]*)"\s+FOREIGN\s+KEY/gi),
  ),
  compareNames(
    "named unique constraints",
    matches(sourceSql, /CONSTRAINT\s+(uq_[a-z_][a-z0-9_]*)\s+UNIQUE\s*\(/gi),
    matches(drizzleSql, /CONSTRAINT\s+"(uq_[a-z_][a-z0-9_]*)"\s+UNIQUE\s*\(/gi),
  ),
];

const sourceForeignKeys = matches(sourceSql, /\bREFERENCES\s+[a-z_][a-z0-9_]*\s*\(/gi, 0).length;
const drizzleForeignKeys = matches(drizzleSql, /\bREFERENCES\s+"public"\."[a-z_][a-z0-9_]*"\s*\(/gi, 0).length;
const sourceIdentity = matches(sourceSql, /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/gi, 0).length;
const drizzleIdentity = matches(drizzleSql, /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/gi, 0).length;
const sourceStored = matches(sourceSql, /GENERATED\s+ALWAYS\s+AS\s*\([\s\S]*?\)\s+STORED/gi, 0).length;
const drizzleStored = matches(drizzleSql, /GENERATED\s+ALWAYS\s+AS\s*\([\s\S]*?\)\s+STORED/gi, 0).length;

for (const [label, source, mapped] of [
  ["foreign-key references", sourceForeignKeys, drizzleForeignKeys],
  ["identity columns", sourceIdentity, drizzleIdentity],
  ["stored generated columns", sourceStored, drizzleStored],
]) {
  const ok = source === mapped;
  console.log(`${label}: source=${source}, drizzle=${mapped}, match=${ok}`);
  comparisons.push(ok);
}

if (comparisons.some((comparison) => !comparison)) process.exit(1);
