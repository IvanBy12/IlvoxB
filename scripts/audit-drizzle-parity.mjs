import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const baselinePath = resolve(
  process.argv[2] ?? resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"),
);
const migrationsFolder = resolve("drizzle", "migrations");
const journal = JSON.parse(
  readFileSync(resolve(migrationsFolder, "meta", "_journal.json"), "utf8"),
);
const versionedSql = [
  readFileSync(baselinePath, "utf8"),
  ...journal.entries.slice(1).map((entry) =>
    readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), "utf8")),
].join("\n");
const drizzleExecutable = resolve("node_modules", "drizzle-kit", "bin.cjs");
const exported = spawnSync(
  process.execPath,
  [drizzleExecutable, "export", "--config", "drizzle.config.ts"],
  { encoding: "utf8" },
);

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

function compareNames(label, sourceValues, drizzleValues) {
  const source = sortedUnique(sourceValues);
  const mapped = sortedUnique(drizzleValues);
  const missing = source.filter((value) => !mapped.includes(value));
  const extra = mapped.filter((value) => !source.includes(value));
  const ok = missing.length === 0 && extra.length === 0;

  console.log(`${label}: versioned=${source.length}, drizzle=${mapped.length}, match=${ok}`);
  if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
  if (extra.length > 0) console.log(`  extra: ${extra.join(", ")}`);
  return ok;
}

function compareRequiredNames(label, sourceValues, drizzleValues) {
  const source = sortedUnique(sourceValues);
  const mapped = sortedUnique(drizzleValues);
  const missing = source.filter((value) => !mapped.includes(value));
  const modeledNames = mapped.filter((value) => !source.includes(value));
  const ok = missing.length === 0;

  console.log(`${label}: versioned-named=${source.length}, drizzle=${mapped.length}, match=${ok}`);
  if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
  if (modeledNames.length > 0) {
    console.log(`  explicit ORM names for implicit baseline constraints: ${modeledNames.length}`);
  }
  return ok;
}

const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"public"\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/giu;
const indexPattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+"?([a-z_][a-z0-9_]*)"?/giu;
const checkPattern = /CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+CHECK\s*\(/giu;
const foreignKeyPattern = /CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+FOREIGN\s+KEY/giu;
const uniquePattern = /CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+UNIQUE\s*\(/giu;

const comparisons = [
  compareNames("tables", matches(versionedSql, tablePattern), matches(drizzleSql, tablePattern)),
  compareNames("explicit indexes", matches(versionedSql, indexPattern), matches(drizzleSql, indexPattern)),
  compareNames("named checks", matches(versionedSql, checkPattern), matches(drizzleSql, checkPattern)),
  compareRequiredNames("foreign keys", matches(versionedSql, foreignKeyPattern), matches(drizzleSql, foreignKeyPattern)),
  compareRequiredNames("unique constraints", matches(versionedSql, uniquePattern), matches(drizzleSql, uniquePattern)),
];

const referencePattern = /\bREFERENCES\s+(?:"public"\.)?"?[a-z_][a-z0-9_]*"?\s*\(/giu;
const identityPattern = /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/giu;
const storedPattern = /GENERATED\s+ALWAYS\s+AS\s*\([\s\S]*?\)\s+STORED/giu;

for (const [label, expression] of [
  ["foreign-key references", referencePattern],
  ["identity columns", identityPattern],
  ["stored generated columns", storedPattern],
]) {
  const source = matches(versionedSql, expression, 0).length;
  const mapped = matches(drizzleSql, expression, 0).length;
  const ok = source === mapped;
  console.log(`${label}: versioned=${source}, drizzle=${mapped}, match=${ok}`);
  comparisons.push(ok);
}

console.log(`terminal migration: ${journal.entries.at(-1)?.tag ?? "missing"}`);
if (comparisons.some((comparison) => !comparison)) process.exit(1);
