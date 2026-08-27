import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import type { AuditContext } from "../../common/audit/audit.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { successResponse } from "../../common/http/api-response.js";
import {
  ClientInvitationClaimBodySchema,
  ClientInvitationCreateBodySchema,
  ClientInvitationOrganizationParamsSchema,
  ClientInvitationParamsSchema,
  type ClientInvitationClaimBody,
  type ClientInvitationCreateBody,
  type ClientInvitationOrganizationParams,
  type ClientInvitationParams,
} from "./client-invitation.schemas.js";
import type { ClientInvitationService } from "./client-invitation.service.js";

export interface ClientInvitationRoutesOptions {
  readonly service: ClientInvitationService;
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

export const clientInvitationRoutes: FastifyPluginCallback<ClientInvitationRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.get<{ Params: ClientInvitationOrganizationParams }>(
    "/organizations/:organizationId/invitations",
    { preHandler: app.requireActor, schema: { params: ClientInvitationOrganizationParamsSchema } },
    async (request) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      return successResponse(await options.service.list(request.actor, request.params.organizationId));
    },
  );

  app.post<{ Params: ClientInvitationOrganizationParams; Body: ClientInvitationCreateBody }>(
    "/organizations/:organizationId/invitations",
    { preHandler: app.requireActor, schema: { params: ClientInvitationOrganizationParamsSchema, body: ClientInvitationCreateBodySchema } },
    async (request, reply) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      const normalizedEmail = request.body.email.trim().toLowerCase();
      try {
        const result = await options.service.create(
          request.actor,
          request.params.organizationId,
          request.body,
          auditContext(request, request.params.organizationId),
        );
        request.log.info({
          requestId: request.id,
          organizationId: request.params.organizationId,
          localInvitationId: result.invitation.id,
          clerkInvitationId: result.invitation.clerkInvitationId,
          normalizedEmail,
          result: result.outcome,
        }, "Client invitation creation completed");
        return reply.status(201).send(successResponse(result));
      } catch (error) {
        request.log.warn({
          requestId: request.id,
          organizationId: request.params.organizationId,
          normalizedEmail,
          errorCode: error instanceof AppError ? error.code : ErrorCode.InternalError,
          result: "failed",
        }, "Client invitation creation failed");
        throw error;
      }
    },
  );

  app.post<{ Params: ClientInvitationParams }>(
    "/organizations/:organizationId/invitations/:invitationId/resend",
    {
      preHandler: app.requireActor,
      schema: { params: ClientInvitationParamsSchema },
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      return successResponse(await options.service.resend(
        request.actor,
        request.params.organizationId,
        request.params.invitationId,
        auditContext(request, request.params.organizationId),
      ));
    },
  );

  app.post<{ Params: ClientInvitationParams }>(
    "/organizations/:organizationId/invitations/:invitationId/revoke",
    { preHandler: app.requireActor, schema: { params: ClientInvitationParamsSchema } },
    async (request) => {
      if (request.actor === null) throw new Error("Authenticated actor was not constructed");
      return successResponse(await options.service.revoke(
        request.actor,
        request.params.organizationId,
        request.params.invitationId,
        auditContext(request, request.params.organizationId),
      ));
    },
  );

  app.post<{ Body: ClientInvitationClaimBody }>(
    "/client-invitations/claim",
    {
      schema: { body: ClientInvitationClaimBodySchema },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const external = await app.authenticationProvider.authenticate(request);
      if (external === null) {
        throw new AppError({
          code: ErrorCode.Unauthenticated,
          message: "Authentication required",
          statusCode: 401,
        });
      }
      try {
        const result = await options.service.claim(
          external.clerkUserId,
          request.body.invitationId,
          auditContext(request),
        );
        request.log.info({
          requestId: request.id,
          clerkUserId: external.clerkUserId,
          localInvitationId: result.invitation.id,
          organizationId: result.invitation.organizationId,
          profileExists: result.profileExisted,
          reconciliationAttempted: result.reconciliationAttempted,
          membershipCreated: result.membershipCreated,
          result: result.alreadyClaimed ? "already_claimed" : "claimed",
        }, "Client invitation claim completed");
        return successResponse({
          invitation: result.invitation,
          alreadyClaimed: result.alreadyClaimed,
        });
      } catch (error) {
        request.log.warn(
          {
            requestId: request.id,
            clerkUserId: external.clerkUserId,
            localInvitationId: request.body.invitationId,
            profileExists: null,
            reconciliationAttempted: false,
            membershipCreated: false,
            errorCode: error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
            result: "failed",
          },
          "Client invitation claim failed",
        );
        throw error;
      }
    },
  );
  done();
};
