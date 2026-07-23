import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  OrganizationCreateBodySchema,
  OrganizationIdParamsSchema,
  OrganizationListQuerySchema,
  OrganizationMemberCreateBodySchema,
  OrganizationMemberParamsSchema,
  OrganizationMemberPatchBodySchema,
  OrganizationPatchBodySchema,
  type OrganizationCreateBody,
  type OrganizationIdParams,
  type OrganizationListQuery,
  type OrganizationMemberCreateBody,
  type OrganizationMemberParams,
  type OrganizationMemberPatchBody,
  type OrganizationPatchBody,
} from "./organization.schemas.js";
import type { OrganizationService } from "./organization.service.js";

export interface OrganizationRoutesOptions {
  readonly service: OrganizationService;
}

function auditContext(request: FastifyRequest, organizationId?: string): AuditContext {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
    ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] }),
  };
}

export const organizationRoutes: FastifyPluginCallback<OrganizationRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.get<{ Querystring: OrganizationListQuery }>("/organizations", {
    preHandler: app.requireActor,
    schema: { querystring: OrganizationListQuerySchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.list(request.actor, {
      page: request.query.page ?? 1,
      pageSize: request.query.pageSize ?? 20,
      ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.createdFrom === undefined ? {} : { createdFrom: new Date(request.query.createdFrom) }),
      ...(request.query.createdTo === undefined ? {} : { createdTo: new Date(request.query.createdTo) }),
    }));
  });

  app.post<{ Body: OrganizationCreateBody }>("/organizations", {
    preHandler: app.requireActor,
    schema: { body: OrganizationCreateBodySchema },
  }, async (request, reply) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    const organization = await options.service.create(request.actor, request.body, auditContext(request));
    return reply.status(201).send(successResponse(organization));
  });

  app.get<{ Params: OrganizationIdParams }>("/organizations/:organizationId", {
    preHandler: app.requireActor,
    schema: { params: OrganizationIdParamsSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.get(request.actor, request.params.organizationId));
  });

  app.patch<{ Params: OrganizationIdParams; Body: OrganizationPatchBody }>(
    "/organizations/:organizationId",
    {
      preHandler: app.requireActor,
      schema: { params: OrganizationIdParamsSchema, body: OrganizationPatchBodySchema },
    },
    async (request) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      return successResponse(await options.service.update(
        request.actor,
        request.params.organizationId,
        request.body,
        auditContext(request, request.params.organizationId),
      ));
    },
  );

  app.get<{ Params: OrganizationIdParams }>("/organizations/:organizationId/members", {
    preHandler: app.requireActor,
    schema: { params: OrganizationIdParamsSchema },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.listMembers(request.actor, request.params.organizationId));
  });

  app.post<{ Params: OrganizationIdParams; Body: OrganizationMemberCreateBody }>(
    "/organizations/:organizationId/members",
    {
      preHandler: app.requireActor,
      schema: { params: OrganizationIdParamsSchema, body: OrganizationMemberCreateBodySchema },
    },
    async (request, reply) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      const member = await options.service.createMember(
        request.actor,
        request.params.organizationId,
        { ...request.body, status: request.body.status ?? "pending" },
        auditContext(request, request.params.organizationId),
      );
      return reply.status(201).send(successResponse(member));
    },
  );

  app.patch<{ Params: OrganizationMemberParams; Body: OrganizationMemberPatchBody }>(
    "/organizations/:organizationId/members/:memberId",
    {
      preHandler: app.requireActor,
      schema: {
        params: OrganizationMemberParamsSchema,
        body: OrganizationMemberPatchBodySchema,
      },
    },
    async (request) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      return successResponse(await options.service.updateMember(
        request.actor,
        request.params.organizationId,
        request.params.memberId,
        request.body,
        auditContext(request, request.params.organizationId),
      ));
    },
  );
  done();
};
