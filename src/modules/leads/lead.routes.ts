import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  LeadAssignmentBodySchema,
  LeadCommercialPatchSchema,
  LeadConversionBodySchema,
  LeadIdParamsSchema,
  LeadListQuerySchema,
  LeadTransitionBodySchema,
  PublicLeadBodySchema,
  type LeadAssignmentBody,
  type LeadCommercialPatchBody,
  type LeadConversionBody,
  type LeadIdParams,
  type LeadListQuery,
  type LeadTransitionBody,
  type PublicLeadBody,
} from "./lead.schemas.js";
import type { LeadService } from "./lead.service.js";

export interface LeadRoutesOptions {
  readonly service: LeadService;
}

function auditContext(request: FastifyRequest): AuditContext {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
    ...(request.headers["user-agent"] === undefined
      ? {}
      : { userAgent: request.headers["user-agent"] }),
  };
}

export const leadRoutes: FastifyPluginCallback<LeadRoutesOptions> = (app, options, done) => {
  app.post<{ Body: PublicLeadBody }>("/leads", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: PublicLeadBodySchema },
  }, async (request, reply) => {
    const lead = await options.service.createPublic(request.body, auditContext(request));
    return reply.status(201).send(successResponse(lead));
  });

  app.get<{ Querystring: LeadListQuery }>("/leads", {
    preHandler: app.requireActor,
    schema: { querystring: LeadListQuerySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.list(request.actor, {
      page: request.query.page ?? 1,
      pageSize: request.query.pageSize ?? 20,
      sortBy: request.query.sortBy ?? "createdAt",
      sortDirection: request.query.sortDirection ?? "desc",
      ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.serviceId === undefined ? {} : { serviceId: request.query.serviceId }),
      ...(request.query.assignedToUserId === undefined
        ? {}
        : { assignedToUserId: request.query.assignedToUserId }),
      ...(request.query.createdFrom === undefined ? {} : { createdFrom: new Date(request.query.createdFrom) }),
      ...(request.query.createdTo === undefined ? {} : { createdTo: new Date(request.query.createdTo) }),
    }));
  });

  app.get<{ Params: LeadIdParams }>("/leads/:leadId", {
    preHandler: app.requireActor,
    schema: { params: LeadIdParamsSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.get(request.actor, request.params.leadId));
  });

  app.get<{ Params: LeadIdParams }>("/leads/:leadId/diagnostic", {
    preHandler: app.requireActor,
    schema: { params: LeadIdParamsSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.getDiagnostic(request.actor, request.params.leadId));
  });

  app.patch<{ Params: LeadIdParams; Body: LeadCommercialPatchBody }>("/leads/:leadId", {
    preHandler: app.requireActor,
    schema: { params: LeadIdParamsSchema, body: LeadCommercialPatchSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.updateCommercial(
      request.actor,
      request.params.leadId,
      request.body,
      auditContext(request),
    ));
  });

  app.post<{ Params: LeadIdParams; Body: LeadTransitionBody }>("/leads/:leadId/transition", {
    preHandler: app.requireActor,
    schema: { params: LeadIdParamsSchema, body: LeadTransitionBodySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.transition(
      request.actor,
      request.params.leadId,
      request.body.status,
      request.body.reason,
      auditContext(request),
    ));
  });

  app.post<{ Params: LeadIdParams; Body: LeadAssignmentBody }>("/leads/:leadId/assign", {
    preHandler: app.requireActor,
    schema: { params: LeadIdParamsSchema, body: LeadAssignmentBodySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.assign(
      request.actor,
      request.params.leadId,
      request.body.assignedToUserId,
      auditContext(request),
    ));
  });

  app.post<{ Params: LeadIdParams; Body: LeadConversionBody }>("/leads/:leadId/convert", {
    preHandler: app.requireActor,
    schema: { params: LeadIdParamsSchema, body: LeadConversionBodySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.convert(
      request.actor,
      request.params.leadId,
      request.body,
      auditContext(request),
    ));
  });
  done();
};
