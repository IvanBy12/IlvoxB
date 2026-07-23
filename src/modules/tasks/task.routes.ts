import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  TaskAssignBodySchema,
  TaskCreateBodySchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  TaskPatchBodySchema,
  TaskTransitionBodySchema,
  type TaskAssignBody,
  type TaskCreateBody,
  type TaskIdParams,
  type TaskListQuery,
  type TaskPatchBody,
  type TaskTransitionBody,
} from "./task.schemas.js";
import type { TaskService } from "./task.service.js";
import type { TaskCreateInput, TaskListInput, TaskPatch } from "./task.types.js";
import type { TaskStatus } from "../../common/state-machines/task-transitions.js";

export interface TaskRoutesOptions {
  readonly service: TaskService;
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

export const taskRoutes: FastifyPluginCallback<TaskRoutesOptions> = (app, options, done) => {
  app.get<{ Querystring: TaskListQuery }>("/tasks", {
    preHandler: app.requireActor,
    schema: { querystring: TaskListQuerySchema },
  }, async (request) => successResponse(await options.service.list(actor(request), {
    page: request.query.page ?? 1,
    pageSize: request.query.pageSize ?? 20,
    sortBy: (request.query.sortBy ?? "createdAt") as TaskListInput["sortBy"],
    sortDirection: (request.query.sortDirection ?? "desc") as TaskListInput["sortDirection"],
    ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
    ...(request.query.status === undefined ? {} : { status: request.query.status }),
    ...(request.query.organizationId === undefined ? {} : { organizationId: request.query.organizationId }),
    ...(request.query.projectId === undefined ? {} : { projectId: request.query.projectId }),
    ...(request.query.assignedToUserId === undefined
      ? {}
      : { assignedToUserId: request.query.assignedToUserId }),
    ...(request.query.createdByUserId === undefined
      ? {}
      : { createdByUserId: request.query.createdByUserId }),
    ...(request.query.dueFrom === undefined ? {} : { dueFrom: request.query.dueFrom }),
    ...(request.query.dueTo === undefined ? {} : { dueTo: request.query.dueTo }),
  } as TaskListInput)));

  app.post<{ Body: TaskCreateBody }>("/tasks", {
    preHandler: app.requireActor,
    schema: { body: TaskCreateBodySchema },
  }, async (request, reply) => reply.status(201).send(successResponse(
    await options.service.create(actor(request), request.body as TaskCreateInput, auditContext(request)),
  )));

  app.get<{ Params: TaskIdParams }>("/tasks/:taskId", {
    preHandler: app.requireActor,
    schema: { params: TaskIdParamsSchema },
  }, async (request) => successResponse(
    await options.service.get(actor(request), request.params.taskId),
  ));

  app.patch<{ Params: TaskIdParams; Body: TaskPatchBody }>("/tasks/:taskId", {
    preHandler: app.requireActor,
    schema: { params: TaskIdParamsSchema, body: TaskPatchBodySchema },
  }, async (request) => {
    const { expectedUpdatedAt, ...body } = request.body;
    const input: TaskPatch = {
      ...body,
      ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: new Date(expectedUpdatedAt) }),
    } as TaskPatch;
    return successResponse(await options.service.update(
      actor(request),
      request.params.taskId,
      input,
      auditContext(request),
    ));
  });

  app.post<{ Params: TaskIdParams; Body: TaskAssignBody }>("/tasks/:taskId/assign", {
    preHandler: app.requireActor,
    schema: { params: TaskIdParamsSchema, body: TaskAssignBodySchema },
  }, async (request) => successResponse(await options.service.assign(
    actor(request),
    request.params.taskId,
    request.body.assignedToUserId,
    request.body.expectedUpdatedAt === undefined
      ? undefined
      : new Date(request.body.expectedUpdatedAt),
    auditContext(request),
  )));

  app.post<{ Params: TaskIdParams; Body: TaskTransitionBody }>("/tasks/:taskId/transition", {
    preHandler: app.requireActor,
    schema: { params: TaskIdParamsSchema, body: TaskTransitionBodySchema },
  }, async (request) => successResponse(await options.service.transition(
    actor(request),
    request.params.taskId,
    request.body.status as TaskStatus,
    request.body.reason,
    auditContext(request),
  )));

  done();
};
