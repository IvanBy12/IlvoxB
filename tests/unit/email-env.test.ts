import { describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { loadEnv } from "../../src/config/env.js";

describe("transactional email environment", () => {
  it("requires Resend credentials, sender, and recipients only when enabled", () => {
    expect(() => loadEnv({ NODE_ENV: "test", EMAIL_PROVIDER: "resend" })).toThrow(AppError);
    const disabled = loadEnv({ NODE_ENV: "test", EMAIL_PROVIDER: "disabled" });
    expect(disabled).toMatchObject({
      EMAIL_PROVIDER: "disabled",
      NOTIFICATION_EMAIL_TO: [],
    });
    expect(disabled.RESEND_API_KEY).toBeUndefined();
  });

  it("validates and normalizes one or more notification recipients", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "test-secret",
      EMAIL_FROM: "ILVOX <notify@example.test>",
      NOTIFICATION_EMAIL_TO: " FIRST@example.test,second@example.test,first@example.test ",
    });
    expect(env.NOTIFICATION_EMAIL_TO).toEqual(["first@example.test", "second@example.test"]);
  });

  it("rejects header injection in EMAIL_FROM", () => {
    expect(() => loadEnv({
      NODE_ENV: "test",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "test-secret",
      EMAIL_FROM: "ILVOX <notify@example.test>\r\nBcc: attacker@example.test",
      NOTIFICATION_EMAIL_TO: "operator@example.test",
    })).toThrow(AppError);
  });
});
