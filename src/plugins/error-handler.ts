import type { FastifyInstance } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import { errorResponse } from "../common/http/api-response.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(errorResponse(ErrorCode.NotFound, "Route not found", request.id));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, "Application error");
      }
      return reply
        .status(error.statusCode)
        .send(errorResponse(error.code, error.message, request.id, error.details));
    }

    const knownError =
      typeof error === "object" && error !== null
        ? (error as {
            readonly code?: string;
            readonly validation?: unknown;
            readonly validationContext?: unknown;
          })
        : undefined;

    if (knownError?.validation !== undefined) {
      return reply.status(400).send(
        errorResponse(ErrorCode.ValidationError, "Request validation failed", request.id, {
          context: knownError.validationContext,
          issues: knownError.validation,
        }),
      );
    }

    if (knownError?.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply
        .status(413)
        .send(errorResponse(ErrorCode.PayloadTooLarge, "Request body is too large", request.id));
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply
      .status(500)
      .send(errorResponse(ErrorCode.InternalError, "Internal server error", request.id));
  });
}
