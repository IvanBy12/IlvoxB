import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  DeliverableCreateBodySchema,
  DeliverablePatchBodySchema,
  MilestoneCreateBodySchema,
  MilestonePatchBodySchema,
  ProjectAssignBodySchema,
  ProjectCreateBodySchema,
  ProjectDeliverableParamsSchema,
  ProjectIdParamsSchema,
  ProjectListQuerySchema,
  ProjectMemberCreateBodySchema,
  ProjectMemberParamsSchema,
  ProjectMemberPatchBodySchema,
  ProjectMilestoneParamsSchema,
  ProjectPatchBodySchema,
  ProjectTransitionBodySchema,
  type DeliverableCreateBody,
  type DeliverablePatchBody,
  type MilestoneCreateBody,
  type MilestonePatchBody,
  type ProjectAssignBody,
  type ProjectCreateBody,
  type ProjectDeliverableParams,
  type ProjectIdParams,
  type ProjectListQuery,
  type ProjectMemberCreateBody,
  type ProjectMemberParams,
  type ProjectMemberPatchBody,
  type ProjectMilestoneParams,
  type ProjectPatchBody,
  type ProjectTransitionBody,
} from "./project.schemas.js";
import type { ProjectService } from "./project.service.js";
import type {
  DeliverablePatch,
  MilestonePatch,
  ProjectCreateInput,
  ProjectListInput,
  ProjectPatch,
  ProjectRoleCode,
} from "./project.types.js";
import type { ProjectStatus } from "../../common/state-machines/project-transitions.js";

export interface ProjectRoutesOptions {
  readonly service: ProjectService;
}

function auditContext(request: FastifyRequest): AuditContext {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
    ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] }),
  };
}

function actor(request: FastifyRequest) {
  if (request.actor === null) throw new Error("Authenticated actor was not constructed");
  return request.actor;
}

export const projectRoutes: FastifyPluginCallback<ProjectRoutesOptions> = (app, options, done) => {
  app.get<{ Querystring: ProjectListQuery }>("/projects", {
    preHandler: app.requireActor,
    schema: { querystring: ProjectListQuerySchema },
  }, async (request) => successResponse(await options.service.list(actor(request), {
    page: request.query.page ?? 1,
    pageSize: request.query.pageSize ?? 20,
    sortBy: (request.query.sortBy ?? "createdAt") as ProjectListInput["sortBy"],
    sortDirection: (request.query.sortDirection ?? "desc") as ProjectListInput["sortDirection"],
    ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
    ...(request.query.status === undefined ? {} : { status: request.query.status }),
    ...(request.query.organizationId === undefined ? {} : { organizationId: request.query.organizationId }),
    ...(request.query.leadUserId === undefined ? {} : { leadUserId: request.query.leadUserId }),
    ...(request.query.startFrom === undefined ? {} : { startFrom: request.query.startFrom }),
    ...(request.query.dueTo === undefined ? {} : { dueTo: request.query.dueTo }),
  } as ProjectListInput)));

  app.post<{ Body: ProjectCreateBody }>("/projects", {
    preHandler: app.requireActor,
    schema: { body: ProjectCreateBodySchema },
  }, async (request, reply) => reply.status(201).send(successResponse(
    await options.service.create(
      actor(request),
      request.body as ProjectCreateInput,
      auditContext(request),
    ),
  )));

  app.get<{ Params: ProjectIdParams }>("/projects/:projectId", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema },
  }, async (request) => successResponse(
    await options.service.get(actor(request), request.params.projectId),
  ));

  app.patch<{ Params: ProjectIdParams; Body: ProjectPatchBody }>("/projects/:projectId", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema, body: ProjectPatchBodySchema },
  }, async (request) => {
    const { expectedUpdatedAt, ...body } = request.body;
    const input: ProjectPatch = {
      ...body,
      ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: new Date(expectedUpdatedAt) }),
    } as ProjectPatch;
    return successResponse(await options.service.update(
      actor(request),
      request.params.projectId,
      input,
      auditContext(request),
    ));
  });

  app.post<{ Params: ProjectIdParams; Body: ProjectAssignBody }>("/projects/:projectId/assign", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema, body: ProjectAssignBodySchema },
  }, async (request) => successResponse(await options.service.assignLead(
    actor(request),
    request.params.projectId,
    request.body.leadUserId,
    request.body.expectedUpdatedAt === undefined
      ? undefined
      : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.post<{ Params: ProjectIdParams; Body: ProjectTransitionBody }>("/projects/:projectId/transition", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema, body: ProjectTransitionBodySchema },
  }, async (request) => successResponse(await options.service.transition(
    actor(request),
    request.params.projectId,
    request.body.status as ProjectStatus,
    request.body.reason,
    auditContext(request),
  )));

  app.get<{ Params: ProjectIdParams }>("/projects/:projectId/members", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema },
  }, async (request) => successResponse(
    await options.service.listMembers(actor(request), request.params.projectId),
  ));

  app.post<{ Params: ProjectIdParams; Body: ProjectMemberCreateBody }>("/projects/:projectId/members", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema, body: ProjectMemberCreateBodySchema },
  }, async (request, reply) => reply.status(201).send(successResponse(
    await options.service.createMember(
      actor(request),
      request.params.projectId,
      request.body.userId,
      request.body.roleCode as ProjectRoleCode,
      auditContext(request),
    ),
  )));

  app.patch<{ Params: ProjectMemberParams; Body: ProjectMemberPatchBody }>(
    "/projects/:projectId/members/:memberId",
    {
      preHandler: app.requireActor,
      schema: { params: ProjectMemberParamsSchema, body: ProjectMemberPatchBodySchema },
    },
    async (request) => successResponse(await options.service.updateMember(
      actor(request),
      request.params.projectId,
      request.params.memberId,
      request.body.roleCode as ProjectRoleCode,
      auditContext(request),
    )),
  );

  app.get<{ Params: ProjectIdParams }>("/projects/:projectId/milestones", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema },
  }, async (request) => successResponse(
    await options.service.listMilestones(actor(request), request.params.projectId),
  ));

  app.post<{ Params: ProjectIdParams; Body: MilestoneCreateBody }>("/projects/:projectId/milestones", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema, body: MilestoneCreateBodySchema },
  }, async (request, reply) => reply.status(201).send(successResponse(
    await options.service.createMilestone(
      actor(request),
      request.params.projectId,
      request.body,
      auditContext(request),
    ),
  )));

  app.get<{ Params: ProjectMilestoneParams }>("/projects/:projectId/milestones/:milestoneId", {
    preHandler: app.requireActor,
    schema: { params: ProjectMilestoneParamsSchema },
  }, async (request) => successResponse(await options.service.getMilestone(
    actor(request),
    request.params.projectId,
    request.params.milestoneId,
  )));

  app.patch<{ Params: ProjectMilestoneParams; Body: MilestonePatchBody }>(
    "/projects/:projectId/milestones/:milestoneId",
    {
      preHandler: app.requireActor,
      schema: { params: ProjectMilestoneParamsSchema, body: MilestonePatchBodySchema },
    },
    async (request) => {
      const { expectedUpdatedAt, ...body } = request.body;
      const input: MilestonePatch = {
        ...body,
        ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: new Date(expectedUpdatedAt) }),
      } as MilestonePatch;
      return successResponse(await options.service.updateMilestone(
        actor(request),
        request.params.projectId,
        request.params.milestoneId,
        input,
        auditContext(request),
      ));
    },
  );

  app.get<{ Params: ProjectIdParams }>("/projects/:projectId/deliverables", {
    preHandler: app.requireActor,
    schema: { params: ProjectIdParamsSchema },
  }, async (request) => successResponse(
    await options.service.listDeliverables(actor(request), request.params.projectId),
  ));

  app.post<{ Params: ProjectIdParams; Body: DeliverableCreateBody }>(
    "/projects/:projectId/deliverables",
    {
      preHandler: app.requireActor,
      schema: { params: ProjectIdParamsSchema, body: DeliverableCreateBodySchema },
    },
    async (request, reply) => reply.status(201).send(successResponse(
      await options.service.createDeliverable(
        actor(request),
        request.params.projectId,
        request.body,
        auditContext(request),
      ),
    )),
  );

  app.get<{ Params: ProjectDeliverableParams }>("/projects/:projectId/deliverables/:deliverableId", {
    preHandler: app.requireActor,
    schema: { params: ProjectDeliverableParamsSchema },
  }, async (request) => successResponse(await options.service.getDeliverable(
    actor(request),
    request.params.projectId,
    request.params.deliverableId,
  )));

  app.patch<{ Params: ProjectDeliverableParams; Body: DeliverablePatchBody }>(
    "/projects/:projectId/deliverables/:deliverableId",
    {
      preHandler: app.requireActor,
      schema: { params: ProjectDeliverableParamsSchema, body: DeliverablePatchBodySchema },
    },
    async (request) => {
      const { expectedUpdatedAt, ...body } = request.body;
      const input: DeliverablePatch = {
        ...body,
        ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: new Date(expectedUpdatedAt) }),
      } as DeliverablePatch;
      return successResponse(await options.service.updateDeliverable(
        actor(request),
        request.params.projectId,
        request.params.deliverableId,
        input,
        auditContext(request),
      ));
    },
  );

  done();
};
