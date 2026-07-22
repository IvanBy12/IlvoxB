import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL_MISSING");
  process.exit(2);
}

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const result = await client.query(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ilvox_phase3_%' ORDER BY nspname",
  );
  console.log(JSON.stringify({ temporarySchemas: result.rows.map((row) => row.nspname), count: result.rowCount }));
  if ((result.rowCount ?? 0) !== 0) process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
