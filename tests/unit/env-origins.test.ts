import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { TEST_ENV } from "../helpers/build-test-app.js";

describe("browser origin configuration", () => {
  it("accepts both explicit local origins for development auth and CORS", () => {
    const config = loadEnv({
      ...TEST_ENV,
      NODE_ENV: "development",
      CORS_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173",
      CLERK_AUTH_ENABLED: "true",
      CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
      CLERK_SECRET_KEY: "sk_test_placeholder",
      CLERK_AUTHORIZED_PARTIES: "http://127.0.0.1:5173,http://localhost:5173",
    });

    expect(config.CORS_ORIGINS).toEqual([
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]);
    expect(config.CLERK_AUTHORIZED_PARTIES).toEqual([
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]);
  });

  it("keeps production restricted to the explicitly configured domain", () => {
    const config = loadEnv({
      ...TEST_ENV,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:password@database.example/ilvox",
      CORS_ORIGINS: "https://app.ilvox.example",
      CLERK_AUTH_ENABLED: "true",
      CLERK_PUBLISHABLE_KEY: "pk_live_placeholder",
      CLERK_SECRET_KEY: "sk_live_placeholder",
      CLERK_AUTHORIZED_PARTIES: "https://app.ilvox.example",
    });

    expect(config.CORS_ORIGINS).toEqual(["https://app.ilvox.example"]);
    expect(config.CLERK_AUTHORIZED_PARTIES).toEqual(["https://app.ilvox.example"]);
  });

  it("rejects wildcard origins", () => {
    expect(() => loadEnv({ ...TEST_ENV, CORS_ORIGINS: "*" })).toThrow();
    expect(() =>
      loadEnv({
        ...TEST_ENV,
        CLERK_AUTH_ENABLED: "true",
        CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
        CLERK_SECRET_KEY: "sk_test_placeholder",
        CLERK_AUTHORIZED_PARTIES: "*",
      }),
    ).toThrow();
  });
});
