import type { FastifyPluginCallback } from "fastify";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { successResponse } from "../../common/http/api-response.js";
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
      throw new AppError({ code: ErrorCode.WebhookInvalid, message: "Invalid webhook", statusCode: 400 });
    }
    let event;
    try {
      event = await options.verifier.verify(rawBody, request);
    } catch {
      throw new AppError({ code: ErrorCode.WebhookInvalid, message: "Invalid webhook", statusCode: 400 });
    }
    try {
      const result = await options.service.process(eventId, rawBody, event);
      return successResponse(result);
    } catch {
      return reply.status(503).send({
        error: { code: ErrorCode.DatabaseUnavailable, message: "Webhook processing unavailable", requestId: request.id },
      });
    }
  });
  done();
};
