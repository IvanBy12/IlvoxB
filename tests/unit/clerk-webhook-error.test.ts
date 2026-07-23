import { describe, expect, it } from "vitest";
import { describeClerkWebhookFailure } from "../../src/modules/webhooks/clerk-webhook-error.js";

const databaseError = (code: string): Error & { code: string } =>
  Object.assign(new Error("Database operation failed"), { code });

describe("Clerk webhook error observability", () => {
  it.each(["42703", "42P01"])("classifies %s as a required migration", (code) => {
    expect(describeClerkWebhookFailure(databaseError(code)).classification).toBe("MIGRATION_REQUIRED");
  });

  it("classifies schema and permission failures", () => {
    expect(describeClerkWebhookFailure(databaseError("3F000")).classification)
      .toBe("DATABASE_SCHEMA_MISMATCH");
    expect(describeClerkWebhookFailure(databaseError("42501")).classification)
      .toBe("DATABASE_PERMISSION_DENIED");
  });

  it.each(["23502", "23503", "23505", "23514"])(
    "classifies constraint SQLSTATE %s",
    (code) => {
      expect(describeClerkWebhookFailure(databaseError(code)).classification)
        .toBe("DATABASE_CONSTRAINT_VIOLATION");
    },
  );

  it("distinguishes connection, payload, collision, and unknown failures", () => {
    expect(describeClerkWebhookFailure(databaseError("ECONNREFUSED")).classification)
      .toBe("DATABASE_UNAVAILABLE");
    expect(describeClerkWebhookFailure(Object.assign(new Error("Invalid input"), { name: "ZodError" })).classification)
      .toBe("WEBHOOK_DATA_INVALID");
    expect(describeClerkWebhookFailure(new Error("WEBHOOK_EVENT_COLLISION")).classification)
      .toBe("WEBHOOK_EVENT_COLLISION");
    expect(describeClerkWebhookFailure(new Error("Unexpected")).classification)
      .toBe("INTERNAL_ERROR");
  });

  it("retains safe database metadata and redacts secrets and personal data", () => {
    const original = Object.assign(
      new Error("failed for person@example.test using postgresql://user:password@localhost/db whsec_secret"),
      {
        code: "23505",
        constraint: "users_person@example.test_key",
        table: "app_users",
        column: "primary_email",
        schema: "public",
      },
    );
    original.stack = `${original.message}\n at postgresql://user:password@localhost/db`;

    const failure = describeClerkWebhookFailure(original);

    expect(failure.databaseError).toEqual({
      code: "23505",
      constraint: "[REDACTED_EMAIL]_key",
      table: "app_users",
      column: "primary_email",
      schema: "public",
    });
    expect(failure.err.message).not.toContain("person@example.test");
    expect(failure.err.message).not.toContain("password");
    expect(failure.err.message).not.toContain("whsec_secret");
    expect(failure.err.stack).not.toContain("postgresql://");
  });
});
