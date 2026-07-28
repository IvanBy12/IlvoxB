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

function compareNames(label, sourceValues, drizzleValues, allowedExpectedExtras = []) {
  const source = sortedUnique(sourceValues);
  const mapped = sortedUnique(drizzleValues);
  const missing = source.filter((value) => !mapped.includes(value));
  const extra = mapped.filter((value) => !source.includes(value) && !allowedExpectedExtras.includes(value));
  const ok = missing.length === 0 && extra.length === 0;

  console.log(`${label}: source=${source.length}, drizzle=${mapped.length}, match=${ok}`);
  const expectedExtras = mapped.filter((value) => allowedExpectedExtras.includes(value));
  if (expectedExtras.length > 0) console.log(`  expected migration additions: ${expectedExtras.join(", ")}`);
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
    [
      "idx_files_organization_audience_active",
      "idx_project_members_active_user",
      "idx_deliverables_milestone",
      "idx_tickets_standalone_requester_created",
      "idx_tickets_updated_at",
    ],
  ),
  compareNames(
    "named checks",
    matches(sourceSql, /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\s*\(/gi),
    matches(drizzleSql, /CONSTRAINT\s+"([a-z_][a-z0-9_]*)"\s+CHECK\s*\(/gi),
    [
      "chk_files_audience",
      "chk_identity_webhook_events_payload_sha256",
      "chk_project_members_status",
      "chk_tickets_project_requires_organization",
      "chk_project_members_revocation",
    ],
  ),
  compareNames(
    "named foreign keys",
    matches(sourceSql, /CONSTRAINT\s+(fk_[a-z_][a-z0-9_]*)\s+FOREIGN\s+KEY/gi),
    matches(drizzleSql, /CONSTRAINT\s+"(fk_[a-z_][a-z0-9_]*)"\s+FOREIGN\s+KEY/gi),
    [
      "fk_deliverables_milestone_project",
      "fk_ticket_comments_ticket_id",
      "fk_tickets_project_id",
    ],
  ),
  compareNames(
    "named unique constraints",
    matches(sourceSql, /CONSTRAINT\s+(uq_[a-z_][a-z0-9_]*)\s+UNIQUE\s*\(/gi),
    matches(drizzleSql, /CONSTRAINT\s+"(uq_[a-z_][a-z0-9_]*)"\s+UNIQUE\s*\(/gi),
    ["uq_project_milestones_id_project_organization"],
  ),
];

const sourceForeignKeys = matches(sourceSql, /\bREFERENCES\s+[a-z_][a-z0-9_]*\s*\(/gi, 0).length;
const drizzleForeignKeys = matches(drizzleSql, /\bREFERENCES\s+"public"\."[a-z_][a-z0-9_]*"\s*\(/gi, 0).length;
const sourceIdentity = matches(sourceSql, /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/gi, 0).length;
const drizzleIdentity = matches(drizzleSql, /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/gi, 0).length;
const sourceStored = matches(sourceSql, /GENERATED\s+ALWAYS\s+AS\s*\([\s\S]*?\)\s+STORED/gi, 0).length;
const drizzleStored = matches(drizzleSql, /GENERATED\s+ALWAYS\s+AS\s*\([\s\S]*?\)\s+STORED/gi, 0).length;

for (const [label, source, mapped, allowedDifference = 0] of [
  ["foreign-key references", sourceForeignKeys, drizzleForeignKeys, 4],
  ["identity columns", sourceIdentity, drizzleIdentity],
  ["stored generated columns", sourceStored, drizzleStored],
]) {
  const ok = mapped === source + allowedDifference;
  console.log(
    `${label}: source=${source}, drizzle=${mapped}, expected-difference=${allowedDifference}, match=${ok}`,
  );
  comparisons.push(ok);
}

if (comparisons.some((comparison) => !comparison)) process.exit(1);
