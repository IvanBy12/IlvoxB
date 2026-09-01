import type { FastifyPluginCallback } from "fastify";
import { successResponse } from "../../common/http/api-response.js";
import { HealthResponseSchema, type HealthResponse } from "./health.schemas.js";
import type { HealthService } from "./health.service.js";

export interface HealthRoutesOptions {
  readonly healthService: HealthService;
}

export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (app, options, done) => {
  const liveness = (): HealthResponse =>
    successResponse({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
    });

  app.get<{ Reply: HealthResponse }>(
    "/health",
    { schema: { response: { 200: HealthResponseSchema } } },
    liveness,
  );

  app.get<{ Reply: HealthResponse }>(
    "/health/live",
    { schema: { response: { 200: HealthResponseSchema } } },
    liveness,
  );

  app.get<{ Reply: HealthResponse }>(
    "/health/ready",
    { schema: { response: { 200: HealthResponseSchema, 503: HealthResponseSchema } } },
    async (_request, reply) => {
      const readiness = await options.healthService.readiness();
      const body = successResponse({
        status: readiness.ready ? ("ready" as const) : ("not_ready" as const),
        timestamp: new Date().toISOString(),
        uptimeSeconds: process.uptime(),
        checks: [...readiness.checks],
      });
      return readiness.ready ? body : reply.status(503).send(body);
    },
  );
  done();
};
