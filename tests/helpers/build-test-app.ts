import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import type { BuildAppOptions } from "../../src/app.js";

export const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3001",
  LOG_LEVEL: "silent",
  TRUST_PROXY: "false",
  CORS_ORIGINS: "http://localhost:5173",
  BODY_LIMIT_BYTES: "1048576",
  RATE_LIMIT_MAX: "1000",
  RATE_LIMIT_WINDOW: "1 minute",
};

export function buildTestApp(
  overrides: NodeJS.ProcessEnv = {},
  dependencies: Omit<BuildAppOptions, "env" | "logger"> = {},
): Promise<FastifyInstance> {
  return buildApp({ env: { ...TEST_ENV, ...overrides }, logger: false, ...dependencies });
}
