export type ClerkWebhookFailureClassification =
  | "MIGRATION_REQUIRED"
  | "DATABASE_SCHEMA_MISMATCH"
  | "DATABASE_PERMISSION_DENIED"
  | "DATABASE_CONSTRAINT_VIOLATION"
  | "DATABASE_UNAVAILABLE"
  | "WEBHOOK_DATA_INVALID"
  | "WEBHOOK_EVENT_COLLISION"
  | "INTERNAL_ERROR";

export interface SafeDatabaseErrorMetadata {
  readonly code: string | null;
  readonly constraint: string | null;
  readonly table: string | null;
  readonly column: string | null;
  readonly schema: string | null;
}

export interface SafeClerkWebhookFailure {
  readonly err: Error;
  readonly classification: ClerkWebhookFailureClassification;
  readonly databaseError: SafeDatabaseErrorMetadata;
}

const MIGRATION_REQUIRED_CODES = new Set(["42703", "42P01"]);
const CONSTRAINT_CODES = new Set(["23502", "23503", "23505", "23514"]);
const CONNECTION_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

const redact = (value: string): string =>
  value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/\b(?:whsec|sk_(?:live|test)|pk_(?:live|test))_[A-Z0-9_-]+\b/giu, "[REDACTED_SECRET]");

function safeStringProperty(error: unknown, property: string): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = Reflect.get(error, property) as unknown;
  return typeof value === "string" ? redact(value) : null;
}

function classify(error: unknown, code: string | null, message: string): ClerkWebhookFailureClassification {
  if (message === "WEBHOOK_EVENT_COLLISION") return "WEBHOOK_EVENT_COLLISION";
  if (MIGRATION_REQUIRED_CODES.has(code ?? "")) return "MIGRATION_REQUIRED";
  if (code === "3F000") return "DATABASE_SCHEMA_MISMATCH";
  if (code === "42501") return "DATABASE_PERMISSION_DENIED";
  if (CONSTRAINT_CODES.has(code ?? "")) return "DATABASE_CONSTRAINT_VIOLATION";
  if (
    CONNECTION_CODES.has(code ?? "") ||
    code?.startsWith("08") === true ||
    /(?:connection (?:terminated|refused)|connect\s+econn|timeout|timed out)/iu.test(message)
  ) {
    return "DATABASE_UNAVAILABLE";
  }
  if (safeStringProperty(error, "name") === "ZodError" || code === "WEBHOOK_DATA_INVALID") {
    return "WEBHOOK_DATA_INVALID";
  }
  return "INTERNAL_ERROR";
}

export function describeClerkWebhookFailure(error: unknown): SafeClerkWebhookFailure {
  const code = safeStringProperty(error, "code");
  const message = safeStringProperty(error, "message") ?? "Webhook processing error";
  const safeError = new Error(message);
  safeError.name = safeStringProperty(error, "name") ?? "Error";
  const stack = safeStringProperty(error, "stack");
  if (stack !== null) safeError.stack = stack;

  return {
    err: safeError,
    classification: classify(error, code, message),
    databaseError: {
      code,
      constraint: safeStringProperty(error, "constraint"),
      table: safeStringProperty(error, "table"),
      column: safeStringProperty(error, "column"),
      schema: safeStringProperty(error, "schema"),
    },
  };
}
