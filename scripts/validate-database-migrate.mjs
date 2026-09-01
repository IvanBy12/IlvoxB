import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { URL } from "node:url";
import pg from "pg";
import "dotenv/config";

const sourceConnectionString = process.env.DATABASE_URL;
if (sourceConnectionString === undefined || sourceConnectionString.trim() === "") {
  throw new Error("DATABASE_URL_MISSING");
}

const sourceUrl = new URL(sourceConnectionString);
if (!["127.0.0.1", "localhost", "::1"].includes(sourceUrl.hostname)) {
  throw new Error("VALIDATION_REQUIRES_LOCAL_POSTGRESQL");
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]+$/u.test(identifier)) throw new Error(`UNSAFE_IDENTIFIER ${identifier}`);
  return `"${identifier}"`;
}

function runJson(script, args, databaseUrl) {
  const result = spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `CHILD_COMMAND_FAILED script=${script} status=${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function expectFailure(script, args, databaseUrl, expectedMessage) {
  const result = spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status === 0 || !`${result.stdout}\n${result.stderr}`.includes(expectedMessage)) {
    throw new Error(`EXPECTED_FAILURE_MISSING script=${script} expected=${expectedMessage}`);
  }
}

function runCommand(script, args, databaseUrl) {
  const result = spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `CHILD_COMMAND_FAILED script=${script} status=${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const databaseName = `ilvox_migration_validation_${randomBytes(6).toString("hex")}`;
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${databaseName}`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;
let report;
let cleanedUp = false;

try {
  await admin.connect();
  const server = (await admin.query(`
    SELECT current_setting('server_version') AS version,
           current_setting('server_version_num')::integer AS version_num,
           pg_is_in_recovery() AS recovery
  `)).rows[0];
  if (Math.floor(server.version_num / 10_000) !== 18 || server.recovery !== false) {
    throw new Error(`UNSUPPORTED_VALIDATION_SERVER ${JSON.stringify(server)}`);
  }

  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  created = true;

  expectFailure(
    "database-migrate.mjs",
    [],
    targetUrl.toString(),
    "EMPTY_DATABASE_BOOTSTRAP_CONFIRMATION_REQUIRED",
  );

  const first = runJson(
    "database-migrate.mjs",
    [`--bootstrap-empty=${databaseName}`],
    targetUrl.toString(),
  );
  const second = runJson("database-migrate.mjs", [], targetUrl.toString());
  const databaseTestOutput = runCommand(
    "test-with-database.mjs",
    ["--database-url"],
    targetUrl.toString(),
  );
  const databaseTestLines = databaseTestOutput.split(/\r?\n/u).map((line) => line.trim());
  const rbac = runJson("audit-rbac.mjs", [], targetUrl.toString());
  const constraints = runJson("audit-constraint-names.mjs", [], targetUrl.toString());

  if (
    first.baselineApplied !== true ||
    first.baselineRecognized !== true ||
    first.applied.length !== 14 ||
    first.terminalMigration !== "0014_phase8f1-email-notifications" ||
    first.historyCount !== 15 ||
    second.applied.length !== 0 ||
    second.historyCount !== 15 ||
    rbac.currentOk !== true ||
    constraints.ok !== true
  ) {
    throw new Error("MIGRATION_VALIDATION_RESULT_MISMATCH");
  }

  report = {
    ok: true,
    postgresql: server.version,
    database: databaseName,
    firstRun: {
      baselineApplied: first.baselineApplied,
      baselineRecognized: first.baselineRecognized,
      applied: first.applied,
      terminalMigration: first.terminalMigration,
      historyCount: first.historyCount,
      catalog: first.catalog,
      rbac: first.rbac,
    },
    secondRun: {
      applied: second.applied,
      historyCount: second.historyCount,
      pending: second.pending,
    },
    audits: {
      databaseTests: {
        ok: true,
        testFiles: databaseTestLines.find((line) => line.startsWith("Test Files")),
        tests: databaseTestLines.find((line) => line.startsWith("Tests")),
      },
      rbac: rbac.currentOk,
      constraints: constraints.ok,
      foreignKeyStructures: constraints.foreignKeyStructures,
    },
    emptyDatabaseGuard: true,
  };
} finally {
  if (created) {
    await admin.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname=$1 AND pid<>pg_backend_pid()
    `, [databaseName]);
    await admin.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`);
    cleanedUp = true;
  }
  await admin.end().catch(() => undefined);
}

report.cleanup = cleanedUp;
console.log(JSON.stringify(report, null, 2));
