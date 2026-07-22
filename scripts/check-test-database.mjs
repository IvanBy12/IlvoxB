import pg from "pg";
import "dotenv/config";
import { URL } from "node:url";

const requestedVariable = process.argv.includes("--database-url")
  ? "DATABASE_URL"
  : "TEST_DATABASE_URL";
const connectionString = process.env[requestedVariable];
if (connectionString === undefined || connectionString.trim() === "") {
  console.error(`${requestedVariable}_MISSING`);
  process.exit(2);
}

const parsed = new URL(connectionString);
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      current_database() AS database,
      current_setting('server_version') AS version,
      current_schema() AS current_schema,
      (
        SELECT count(*)::integer
        FROM pg_class
        WHERE relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
          AND relkind = 'r'
      ) AS user_tables
      ,(
        SELECT count(*)::integer
        FROM pg_namespace
        WHERE nspname LIKE 'ilvox_validation_20260722_%'
      ) AS validation_schemas
  `);
  const row = result.rows[0];
  console.log(
    JSON.stringify(
      {
        available: true,
        variable: requestedVariable,
        host: parsed.hostname,
        port: parsed.port || "5432",
        database: parsed.pathname.replace(/^\//, ""),
        version: row.version,
        currentSchema: row.current_schema,
        userTables: row.user_tables,
        validationSchemas: row.validation_schemas,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        available: true,
        variable: requestedVariable,
        host: parsed.hostname,
        port: parsed.port || "5432",
        database: parsed.pathname.replace(/^\//, ""),
        credentialsPresent: parsed.username.length > 0 && parsed.password.length > 0,
        passwordUsesPercentEncoding: /%[0-9A-Fa-f]{2}/.test(parsed.password),
        connectionSucceeded: false,
        errorCode:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "UNKNOWN",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
