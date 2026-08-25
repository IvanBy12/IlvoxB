import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  DiagnosticDraftBodySchema,
  DiagnosticEvaluateBodySchema,
  type DiagnosticDraftBody,
  type DiagnosticEvaluateBody,
} from "./diagnostic.schemas.js";
import type { DiagnosticService } from "./diagnostic.service.js";

export interface DiagnosticRoutesOptions { readonly service: DiagnosticService }

function auditContext(request: FastifyRequest): AuditContext {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
    ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] }),
  };
}

export const diagnosticRoutes: FastifyPluginCallback<DiagnosticRoutesOptions> = (app, options, done) => {
  app.get("/diagnostic", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async () => successResponse(await options.service.getPublic()));

  app.post<{ Body: DiagnosticEvaluateBody }>("/diagnostic/evaluate", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: DiagnosticEvaluateBodySchema },
  }, async (request, reply) => {
    const result = await options.service.evaluate(
      request.body.ruleSetId,
      request.body.answers,
      request.body.initialNeedCode,
    );
    return reply.status(201).send(successResponse(result));
  });

  app.get("/admin/diagnostic", { preHandler: app.requireActor }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.getAdmin(request.actor));
  });

  app.put<{ Body: DiagnosticDraftBody }>("/admin/diagnostic/draft", {
    preHandler: app.requireActor,
    schema: { body: DiagnosticDraftBodySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.saveDraft(request.actor, request.body, auditContext(request)));
  });

  app.post("/admin/diagnostic/publish", { preHandler: app.requireActor }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.publish(request.actor, auditContext(request)));
  });
  done();
};
