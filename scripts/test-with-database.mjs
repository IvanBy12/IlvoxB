import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import "dotenv/config";

const useDatabaseUrl = process.argv.includes("--database-url");
const sourceVariable = useDatabaseUrl ? "DATABASE_URL" : "TEST_DATABASE_URL";
const connectionString = process.env[sourceVariable];

if (connectionString === undefined || connectionString.trim() === "") {
  console.error(`${sourceVariable}_MISSING`);
  process.exit(2);
}

const vitest = resolve("node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run"], {
  stdio: "inherit",
  env: {
    ...process.env,
    TEST_DATABASE_URL: connectionString,
  },
});

process.exit(result.status ?? 1);
