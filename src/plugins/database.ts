import fastifyPlugin from "fastify-plugin";
import type { AppEnv } from "../config/env.js";
import { createDatabaseClient } from "../db/client.js";

interface DatabasePluginOptions {
  readonly env: AppEnv;
}

export const databasePlugin = fastifyPlugin<DatabasePluginOptions>(
  (app, options) => {
    if (options.env.DATABASE_URL === undefined) {
      app.decorate("database", null);
      app.decorate("databasePool", null);
      return;
    }

    const client = createDatabaseClient({ ...options.env, DATABASE_URL: options.env.DATABASE_URL });
    app.decorate("database", client.database);
    app.decorate("databasePool", client.pool);
    app.healthService.registerReadinessCheck("database", async () => {
      await client.pool.query("select 1");
    });

    app.addHook("onClose", async () => {
      await client.pool.end();
    });
  },
  { name: "database" },
);
