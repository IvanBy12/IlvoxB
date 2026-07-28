import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import type { TicketStatus } from "../../common/state-machines/ticket-transitions.js";
import {
  TicketAssignBodySchema,
  TicketCommentCreateBodySchema,
  TicketConfirmBodySchema,
  TicketCreateBodySchema,
  TicketIdParamsSchema,
  TicketListQuerySchema,
  TicketPatchBodySchema,
  TicketPriorityBodySchema,
  TicketReopenBodySchema,
  TicketTransitionBodySchema,
  type TicketAssignBody,
  type TicketCommentCreateBody,
  type TicketConfirmBody,
  type TicketCreateBody,
  type TicketIdParams,
  type TicketListQuery,
  type TicketPatchBody,
  type TicketPriorityBody,
  type TicketReopenBody,
  type TicketTransitionBody,
} from "./ticket.schemas.js";
import type { TicketService } from "./ticket.service.js";
import type {
  TicketCommentVisibility,
  TicketCreateInput,
  TicketListInput,
  TicketPatch,
  TicketPriority,
} from "./ticket.types.js";

export interface TicketRoutesOptions {
  readonly service: TicketService;
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

export const ticketRoutes: FastifyPluginCallback<TicketRoutesOptions> = (app, options, done) => {
  app.get<{ Querystring: TicketListQuery }>("/tickets", {
    preHandler: app.requireActor,
    schema: { querystring: TicketListQuerySchema },
  }, async (request) => successResponse(await options.service.list(actor(request), {
    page: request.query.page ?? 1,
    pageSize: request.query.pageSize ?? 20,
    sortBy: (request.query.sortBy ?? "createdAt") as TicketListInput["sortBy"],
    sortDirection: (request.query.sortDirection ?? "desc") as TicketListInput["sortDirection"],
    ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
    ...(request.query.status === undefined ? {} : { status: request.query.status }),
    ...(request.query.priority === undefined ? {} : { priority: request.query.priority }),
    ...(request.query.organizationId === undefined ? {} : { organizationId: request.query.organizationId }),
    ...(request.query.projectId === undefined ? {} : { projectId: request.query.projectId }),
    ...(request.query.requesterUserId === undefined ? {} : { requesterUserId: request.query.requesterUserId }),
    ...(request.query.assignedToUserId === undefined ? {} : { assignedToUserId: request.query.assignedToUserId }),
    ...(request.query.createdFrom === undefined ? {} : { createdFrom: new Date(request.query.createdFrom) }),
    ...(request.query.createdTo === undefined ? {} : { createdTo: new Date(request.query.createdTo) }),
    ...(request.query.updatedFrom === undefined ? {} : { updatedFrom: new Date(request.query.updatedFrom) }),
    ...(request.query.updatedTo === undefined ? {} : { updatedTo: new Date(request.query.updatedTo) }),
  } as TicketListInput)));

  app.post<{ Body: TicketCreateBody }>("/tickets", {
    preHandler: app.requireActor,
    schema: { body: TicketCreateBodySchema },
  }, async (request, reply) => reply.status(201).send(successResponse(
    await options.service.create(actor(request), request.body as TicketCreateInput, auditContext(request)),
  )));

  app.get<{ Params: TicketIdParams }>("/tickets/:ticketId", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema },
  }, async (request) => successResponse(await options.service.get(actor(request), request.params.ticketId)));

  app.patch<{ Params: TicketIdParams; Body: TicketPatchBody }>("/tickets/:ticketId", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketPatchBodySchema },
  }, async (request) => {
    const { expectedUpdatedAt, ...body } = request.body;
    const input: TicketPatch = {
      ...body,
      ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: new Date(expectedUpdatedAt) }),
    } as TicketPatch;
    return successResponse(await options.service.update(
      actor(request),
      request.params.ticketId,
      input,
      auditContext(request),
    ));
  });

  app.post<{ Params: TicketIdParams; Body: TicketAssignBody }>("/tickets/:ticketId/assign", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketAssignBodySchema },
  }, async (request) => successResponse(await options.service.assign(
    actor(request),
    request.params.ticketId,
    request.body.assignedToUserId,
    request.body.expectedUpdatedAt === undefined ? undefined : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.post<{ Params: TicketIdParams; Body: TicketPriorityBody }>("/tickets/:ticketId/priority", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketPriorityBodySchema },
  }, async (request) => successResponse(await options.service.changePriority(
    actor(request),
    request.params.ticketId,
    request.body.priority as TicketPriority,
    request.body.expectedUpdatedAt === undefined ? undefined : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.post<{ Params: TicketIdParams; Body: TicketTransitionBody }>("/tickets/:ticketId/transition", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketTransitionBodySchema },
  }, async (request) => successResponse(await options.service.transition(
    actor(request),
    request.params.ticketId,
    request.body.status as TicketStatus,
    request.body.resolution,
    request.body.reason,
    request.body.expectedUpdatedAt === undefined ? undefined : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.post<{ Params: TicketIdParams; Body: TicketConfirmBody }>("/tickets/:ticketId/confirm", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketConfirmBodySchema },
  }, async (request) => successResponse(await options.service.confirmResolution(
    actor(request),
    request.params.ticketId,
    request.body.decision as "confirm" | "reject",
    request.body.reason,
    request.body.expectedUpdatedAt === undefined ? undefined : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.post<{ Params: TicketIdParams; Body: TicketReopenBody }>("/tickets/:ticketId/reopen", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketReopenBodySchema },
  }, async (request) => successResponse(await options.service.requestReopen(
    actor(request),
    request.params.ticketId,
    request.body.reason,
    request.body.expectedUpdatedAt === undefined ? undefined : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.get<{ Params: TicketIdParams }>("/tickets/:ticketId/comments", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema },
  }, async (request) => successResponse(
    await options.service.listComments(actor(request), request.params.ticketId),
  ));

  app.post<{ Params: TicketIdParams; Body: TicketCommentCreateBody }>("/tickets/:ticketId/comments", {
    preHandler: app.requireActor,
    schema: { params: TicketIdParamsSchema, body: TicketCommentCreateBodySchema },
  }, async (request, reply) => reply.status(201).send(successResponse(
    await options.service.createComment(
      actor(request),
      request.params.ticketId,
      request.body.content,
      request.body.visibility as TicketCommentVisibility | undefined,
      auditContext(request),
    ),
  )));

  done();
};
