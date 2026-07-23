import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  ServiceIdParamsSchema,
  ServiceListQuerySchema,
  ServiceCreateBodySchema,
  ServicePatchBodySchema,
  type ServiceCreateBody,
  type ServiceIdParams,
  type ServiceListQuery,
  type ServicePatchBody,
} from "./service-catalog.schemas.js";
import type { ServiceCatalogService } from "./service-catalog.service.js";
import type { ServiceCatalogListInput } from "./service-catalog.types.js";

export interface ServiceCatalogRoutesOptions {
  readonly service: ServiceCatalogService;
}

function listInput(query: ServiceListQuery): ServiceCatalogListInput {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    ...(query.search === undefined ? {} : { search: query.search.trim() }),
    ...(query.category === undefined ? {} : { category: query.category }),
    ...(query.isPublic === undefined ? {} : { isPublic: query.isPublic === true || query.isPublic === "true" }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive === true || query.isActive === "true" }),
  };
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

export const serviceCatalogRoutes: FastifyPluginCallback<ServiceCatalogRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.get<{ Querystring: ServiceListQuery }>("/services", {
    schema: { querystring: ServiceListQuerySchema },
  }, async (request) => successResponse(await options.service.listPublic(listInput(request.query))));

  app.get<{ Params: ServiceIdParams }>("/services/:serviceId", {
    schema: { params: ServiceIdParamsSchema },
  }, async (request) => successResponse(await options.service.getPublic(request.params.serviceId)));

  app.get<{ Querystring: ServiceListQuery }>("/admin/services", {
    preHandler: app.requireActor,
    schema: { querystring: ServiceListQuerySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.listAdmin(request.actor, listInput(request.query)));
  });

  app.get<{ Params: ServiceIdParams }>("/admin/services/:serviceId", {
    preHandler: app.requireActor,
    schema: { params: ServiceIdParamsSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.getAdmin(request.actor, request.params.serviceId));
  });

  app.post<{ Body: ServiceCreateBody }>("/admin/services", {
    preHandler: app.requireActor,
    schema: { body: ServiceCreateBodySchema },
  }, async (request, reply) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    const service = await options.service.createAdmin(request.actor, {
      ...request.body,
      isPublic: request.body.isPublic ?? true,
      isActive: request.body.isActive ?? true,
    }, auditContext(request));
    return reply.status(201).send(successResponse(service));
  });

  app.patch<{ Params: ServiceIdParams; Body: ServicePatchBody }>(
    "/admin/services/:serviceId",
    {
      preHandler: app.requireActor,
      schema: { params: ServiceIdParamsSchema, body: ServicePatchBodySchema },
    },
    async (request) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      return successResponse(await options.service.updateAdmin(
        request.actor,
        request.params.serviceId,
        request.body,
        auditContext(request),
      ));
    },
  );
  done();
};
