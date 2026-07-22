import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { runInTransaction } from "../../src/db/transaction.js";
import { TEST_ENV } from "../helpers/build-test-app.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(testDatabaseUrl === undefined)("PostgreSQL integration", () => {
  let client: DatabaseClient;

  beforeAll(() => {
    const config = loadEnv({
      ...TEST_ENV,
      DATABASE_URL: testDatabaseUrl,
      DATABASE_POOL_MAX: "1",
    });
    if (config.DATABASE_URL === undefined) throw new Error("TEST_DATABASE_URL is required");
    client = createDatabaseClient({ ...config, DATABASE_URL: config.DATABASE_URL });
  });

  afterAll(async () => {
    await client.pool.end();
  });

  it("opens a real connection", async () => {
    const result = await client.pool.query<{ value: number }>("select 1::int as value");
    expect(result.rows[0]?.value).toBe(1);
  });

  it("rolls back failed transactions", async () => {
    const rollbackMarker = new Error("intentional rollback");

    await expect(
      runInTransaction(client.database, async (transaction) => {
        await transaction.execute(sql`create temporary table ilvox_transaction_probe (id integer)`);
        await transaction.execute(sql`insert into ilvox_transaction_probe (id) values (1)`);
        throw rollbackMarker;
      }),
    ).rejects.toBe(rollbackMarker);

    const result = await client.pool.query<{ relation: string | null }>(
      "select to_regclass('pg_temp.ilvox_transaction_probe')::text as relation",
    );
    expect(result.rows[0]?.relation).toBeNull();
  });
});
