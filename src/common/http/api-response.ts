import type { ErrorCodeValue } from "../errors/error-codes.js";

export interface ApiSuccess<T> {
  readonly data: T;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCodeValue;
    readonly message: string;
    readonly requestId: string;
    readonly details?: Readonly<Record<string, unknown>> | readonly unknown[];
  };
}

export function successResponse<T>(data: T): ApiSuccess<T> {
  return { data };
}

export function errorResponse(
  code: ErrorCodeValue,
  message: string,
  requestId: string,
  details?: Readonly<Record<string, unknown>> | readonly unknown[],
): ApiErrorBody {
  return details === undefined
    ? { error: { code, message, requestId } }
    : { error: { code, message, requestId, details } };
}
