import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

export async function closeGracefully(app: FastifyInstance, signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  await app.close();
}

export function installShutdownHandlers(app: FastifyInstance): () => void {
  let closing = false;
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => {
      if (closing) return;
      closing = true;
      void closeGracefully(app, signal)
        .then(() => {
          process.exitCode = 0;
        })
        .catch((error: unknown) => {
          app.log.error({ err: error, signal }, "Graceful shutdown failed");
          process.exitCode = 1;
        });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  const app = await buildApp({ env });
  installShutdownHandlers(app);
  await app.listen({ host: app.config.HOST, port: app.config.PORT });
  return app;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    console.error(`Unable to start ILVOX backend: ${message}`);
    process.exitCode = 1;
  });
}
