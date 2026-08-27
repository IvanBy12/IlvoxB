import type { FastifyPluginCallback } from "fastify";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { successResponse } from "../../common/http/api-response.js";
import { describeClerkWebhookFailure } from "./clerk-webhook-error.js";
import type { ClerkWebhookProcessor, ClerkWebhookVerifier } from "./clerk-webhook.types.js";

export interface ClerkWebhookRoutesOptions {
  readonly verifier: ClerkWebhookVerifier;
  readonly service: ClerkWebhookProcessor;
}

function eventIdFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const value = headers["webhook-id"] ?? headers["svix-id"];
  return Array.isArray(value) ? value[0] : value;
}

export const clerkWebhookRoutes: FastifyPluginCallback<ClerkWebhookRoutesOptions> = (app, options, done) => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, next) => {
    next(null, body);
  });

  app.post<{ Body: Buffer }>("/webhooks/clerk", async (request, reply) => {
    const rawBody = request.body;
    const eventId = eventIdFromHeaders(request.headers);
    if (!Buffer.isBuffer(rawBody) || eventId === undefined || eventId.trim() === "") {
      request.log.warn(
        { requestId: request.id, eventId: eventId ?? null, result: "invalid_request" },
        "Clerk webhook rejected",
      );
      throw new AppError({ code: ErrorCode.WebhookInvalid, message: "Invalid webhook", statusCode: 400 });
    }
    let event;
    try {
      event = await options.verifier.verify(rawBody, request);
    } catch {
      request.log.warn(
        { requestId: request.id, eventId, result: "verification_failed" },
        "Clerk webhook rejected",
      );
      throw new AppError({ code: ErrorCode.WebhookInvalid, message: "Invalid webhook", statusCode: 400 });
    }
    try {
      const result = await options.service.process(eventId, rawBody, event);
      request.log.info(
        {
          requestId: request.id,
          eventId,
          eventType: event.type,
          clerkUserId: event.clerkUserId,
          result: result.status,
        },
        "Clerk webhook synchronization completed",
      );
      return successResponse(result);
    } catch (error) {
      const failure = describeClerkWebhookFailure(error);
      request.log.error(
        {
          err: failure.err,
          requestId: request.id,
          eventId,
          eventType: event.type,
          clerkUserId: event.clerkUserId,
          result: "failed",
          classification: failure.classification,
          databaseError: failure.databaseError,
        },
        "Clerk webhook processing failed",
      );
      return reply.status(503).send({
        error: { code: ErrorCode.DatabaseUnavailable, message: "Webhook processing unavailable", requestId: request.id },
      });
    }
  });
  done();
};
