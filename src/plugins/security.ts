import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { AppError } from "../common/errors/app-error.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import type { AppEnv } from "../config/env.js";

export interface SecurityPluginOptions {
  readonly env: AppEnv;
}

const securityPluginImplementation: FastifyPluginAsync<SecurityPluginOptions> = async (
  app,
  options,
) => {
  const allowedOrigins = new Set(options.env.CORS_ORIGINS);

  await app.register(cors, {
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: ["Retry-After", "X-Request-Id"],
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: options.env.RATE_LIMIT_MAX,
    timeWindow: options.env.RATE_LIMIT_WINDOW,
    errorResponseBuilder() {
      return new AppError({
        code: ErrorCode.RateLimited,
        message: "Too many requests",
        statusCode: 429,
      });
    },
  });
};

export const securityPlugin = fastifyPlugin(securityPluginImplementation, {
  name: "ilvox-security",
});
