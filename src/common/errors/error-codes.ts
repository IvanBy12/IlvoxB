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
  InvitationInvalid: "INVITATION_INVALID",
  InvitationExpired: "INVITATION_EXPIRED",
  InvitationRevoked: "INVITATION_REVOKED",
  InvitationUsed: "INVITATION_USED",
  InvitationEmailMismatch: "INVITATION_EMAIL_MISMATCH",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
