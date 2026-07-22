import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { ErrorCode } from "../common/errors/error-codes.js";
import { errorResponse } from "../common/http/api-response.js";
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
    errorResponseBuilder(request) {
      return errorResponse(ErrorCode.RateLimited, "Too many requests", request.id);
    },
  });
};

export const securityPlugin = fastifyPlugin(securityPluginImplementation, {
  name: "ilvox-security",
});
