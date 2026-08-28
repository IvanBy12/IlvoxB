import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { successResponse } from "../../common/http/api-response.js";
import { DeliverableFileParamsSchema, FileIdParamsSchema, FileUploadIntentBodySchema,
  type DeliverableFileParams, type FileIdParams, type FileUploadIntentBody } from "./file.schemas.js";
import type { FileService } from "./file.service.js";

function actor(request: FastifyRequest) { if (request.actor === null) throw new Error("Authenticated actor was not constructed"); return request.actor; }
function audit(request: FastifyRequest): AuditContext { return { requestId: request.id, ipAddress: request.ip,
  ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
  ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] }) }; }

export const fileRoutes: FastifyPluginCallback<{ readonly service: FileService }> = (app, options, done) => {
  app.post<{ Body: FileUploadIntentBody }>("/files/upload-intents", { preHandler: app.requireActor,
    schema: { body: FileUploadIntentBodySchema } }, async (request, reply) => reply.status(201).send(successResponse(
      await options.service.createUploadIntent(actor(request), request.body, audit(request)))));
  app.post<{ Params: FileIdParams }>("/files/:fileId/complete", { preHandler: app.requireActor,
    schema: { params: FileIdParamsSchema } }, async (request) => successResponse(await options.service.complete(actor(request), request.params.fileId, audit(request))));
  app.post<{ Params: FileIdParams }>("/files/:fileId/download-url", { preHandler: app.requireActor,
    schema: { params: FileIdParamsSchema } }, async (request) => successResponse(await options.service.createDownloadUrl(actor(request), request.params.fileId)));
  app.delete<{ Params: FileIdParams }>("/files/:fileId", { preHandler: app.requireActor,
    schema: { params: FileIdParamsSchema } }, async (request, reply) => { await options.service.delete(actor(request), request.params.fileId, audit(request)); return reply.status(204).send(); });
  app.get<{ Params: DeliverableFileParams }>("/deliverables/:deliverableId/files", { preHandler: app.requireActor,
    schema: { params: DeliverableFileParamsSchema } }, async (request) => successResponse(await options.service.listDeliverableFiles(actor(request), request.params.deliverableId)));
  done();
};
