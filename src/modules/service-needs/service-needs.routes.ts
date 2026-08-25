import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  ServiceNeedCreateBodySchema,
  ServiceNeedIdParamsSchema,
  ServiceNeedLinksBodySchema,
  ServiceNeedListQuerySchema,
  ServiceNeedPatchBodySchema,
  type ServiceNeedCreateBody,
  type ServiceNeedIdParams,
  type ServiceNeedLinksBody,
  type ServiceNeedListQuery,
  type ServiceNeedPatchBody,
} from "./service-needs.schemas.js";
import type { ServiceNeedService } from "./service-needs.service.js";
import type { ServiceNeedListInput } from "./service-needs.types.js";

export interface ServiceNeedRoutesOptions { readonly service: ServiceNeedService }

function listInput(query: ServiceNeedListQuery): ServiceNeedListInput {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    ...(query.search === undefined ? {} : { search: query.search.trim() }),
    ...(query.isPublic === undefined ? {} : { isPublic: query.isPublic === true || query.isPublic === "true" }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive === true || query.isActive === "true" }),
  };
}

function auditContext(request: FastifyRequest): AuditContext {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
    ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] }),
  };
}

export const serviceNeedRoutes: FastifyPluginCallback<ServiceNeedRoutesOptions> = (app, options, done) => {
  const publicConfig = { rateLimit: { max: 60, timeWindow: "1 minute" } };

  app.get<{ Querystring: ServiceNeedListQuery }>("/service-needs", {
    config: publicConfig,
    schema: { querystring: ServiceNeedListQuerySchema },
  }, async (request) => successResponse(await options.service.listPublic(listInput(request.query))));

  app.get<{ Params: ServiceNeedIdParams }>("/service-needs/:needId", {
    config: publicConfig,
    schema: { params: ServiceNeedIdParamsSchema },
  }, async (request) => successResponse(await options.service.getPublic(request.params.needId)));

  app.get<{ Params: ServiceNeedIdParams }>("/service-needs/:needId/services", {
    config: publicConfig,
    schema: { params: ServiceNeedIdParamsSchema },
  }, async (request) => successResponse(await options.service.listPublicServices(request.params.needId)));

  app.get<{ Querystring: ServiceNeedListQuery }>("/admin/service-needs", {
    preHandler: app.requireActor,
    schema: { querystring: ServiceNeedListQuerySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.listAdmin(request.actor, listInput(request.query)));
  });

  app.get<{ Params: ServiceNeedIdParams }>("/admin/service-needs/:needId", {
    preHandler: app.requireActor,
    schema: { params: ServiceNeedIdParamsSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.getAdmin(request.actor, request.params.needId));
  });

  app.post<{ Body: ServiceNeedCreateBody }>("/admin/service-needs", {
    preHandler: app.requireActor,
    schema: { body: ServiceNeedCreateBodySchema },
  }, async (request, reply) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    const need = await options.service.createAdmin(request.actor, {
      ...request.body,
      displayOrder: request.body.displayOrder ?? 0,
      isPublic: request.body.isPublic ?? true,
      isActive: request.body.isActive ?? true,
    }, auditContext(request));
    return reply.status(201).send(successResponse(need));
  });

  app.patch<{ Params: ServiceNeedIdParams; Body: ServiceNeedPatchBody }>("/admin/service-needs/:needId", {
    preHandler: app.requireActor,
    schema: { params: ServiceNeedIdParamsSchema, body: ServiceNeedPatchBodySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.updateAdmin(request.actor, request.params.needId, request.body, auditContext(request)));
  });

  app.put<{ Params: ServiceNeedIdParams; Body: ServiceNeedLinksBody }>("/admin/service-needs/:needId/services", {
    preHandler: app.requireActor,
    schema: { params: ServiceNeedIdParamsSchema, body: ServiceNeedLinksBodySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.replaceServices(request.actor, request.params.needId, request.body.services, auditContext(request)));
  });

  done();
};
