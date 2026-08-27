import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  InternalInvitationClaimBodySchema,
  InternalInvitationClaimResponseSchema,
  InternalInvitationCreateBodySchema,
  InternalInvitationCreateResponseSchema,
  InternalInvitationParamsSchema,
  InternalInvitationResponseSchema,
  InternalInvitationsResponseSchema,
  InternalRolesResponseSchema,
  type InternalInvitationClaimBody,
  type InternalInvitationCreateBody,
  type InternalInvitationParams,
} from "./internal-invitation.schemas.js";
import type { InternalInvitationService } from "./internal-invitation.service.js";

export interface InternalInvitationRoutesOptions { readonly service: InternalInvitationService; }

function auditContext(request: FastifyRequest): AuditContext {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.actor === null ? {} : { actorUserId: request.actor.localUserId }),
    ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] }),
  };
}

export const internalInvitationRoutes: FastifyPluginCallback<InternalInvitationRoutesOptions> = (app, options, done) => {
  app.get("/internal-roles", {
    preHandler: app.requireActor,
    schema: { response: { 200: InternalRolesResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.listRoles(request.actor));
  });

  app.get("/internal-invitations", {
    preHandler: app.requireActor,
    schema: { response: { 200: InternalInvitationsResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.list(request.actor));
  });

  app.post<{ Body: InternalInvitationCreateBody }>("/internal-invitations", {
    preHandler: app.requireActor,
    schema: { body: InternalInvitationCreateBodySchema, response: { 201: InternalInvitationCreateResponseSchema } },
  }, async (request, reply) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    const result = await options.service.create(request.actor, request.body, auditContext(request));
    return reply.status(201).send(successResponse(result));
  });

  app.post<{ Params: InternalInvitationParams }>("/internal-invitations/:invitationId/resend", {
    preHandler: app.requireActor,
    schema: { params: InternalInvitationParamsSchema, response: { 200: InternalInvitationResponseSchema } },
    config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.resend(request.actor, request.params.invitationId, auditContext(request)));
  });

  app.post<{ Params: InternalInvitationParams }>("/internal-invitations/:invitationId/revoke", {
    preHandler: app.requireActor,
    schema: { params: InternalInvitationParamsSchema, response: { 200: InternalInvitationResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.revoke(request.actor, request.params.invitationId, auditContext(request)));
  });

  app.post<{ Body: InternalInvitationClaimBody }>("/internal-invitations/claim", {
    schema: { body: InternalInvitationClaimBodySchema, response: { 200: InternalInvitationClaimResponseSchema } },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request) => {
    const external = await app.authenticationProvider.authenticate(request);
    if (external === null) {
      throw new AppError({ code: ErrorCode.Unauthenticated, message: "Authentication required", statusCode: 401 });
    }
    return successResponse(await options.service.claim(external.clerkUserId, request.body.invitationId, auditContext(request)));
  });
  done();
};
