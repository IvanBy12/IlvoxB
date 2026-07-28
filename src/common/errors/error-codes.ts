export const ErrorCode = {
  ConfigurationError: "CONFIGURATION_ERROR",
  ValidationError: "VALIDATION_ERROR",
  NotFound: "NOT_FOUND",
  PayloadTooLarge: "PAYLOAD_TOO_LARGE",
  RateLimited: "RATE_LIMITED",
  InternalError: "INTERNAL_ERROR",
  DatabaseUnavailable: "DATABASE_UNAVAILABLE",
  Unauthenticated: "UNAUTHENTICATED",
  Forbidden: "FORBIDDEN",
  ProfileNotSynchronized: "PROFILE_NOT_SYNCHRONIZED",
  ProfilePending: "PROFILE_PENDING",
  ProfileInactive: "PROFILE_INACTIVE",
  Conflict: "CONFLICT",
  WebhookInvalid: "WEBHOOK_INVALID",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
