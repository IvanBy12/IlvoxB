import type { ErrorCodeValue } from "./error-codes.js";

export interface AppErrorOptions {
  readonly code: ErrorCodeValue;
  readonly message: string;
  readonly statusCode: number;
  readonly details?: Readonly<Record<string, unknown>> | readonly unknown[];
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly statusCode: number;
  readonly details: Readonly<Record<string, unknown>> | readonly unknown[] | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}
