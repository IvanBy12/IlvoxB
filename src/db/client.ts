import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AppEnv } from "../config/env.js";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  readonly database: Database;
  readonly pool: Pool;
}

export function createDatabaseClient(config: AppEnv & { DATABASE_URL: string }): DatabaseClient {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
    application_name: "ilvox-backend",
  });

  return {
    pool,
    database: drizzle({ client: pool, schema }),
  };
}
