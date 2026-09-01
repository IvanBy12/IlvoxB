import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../src/common/errors/app-error.js";
import { ErrorCode } from "../../src/common/errors/error-codes.js";
import { loadEnv } from "../../src/config/env.js";
import { closeGracefully } from "../../src/server.js";
import { buildTestApp, TEST_ENV } from "../helpers/build-test-app.js";

describe("application skeleton", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
  });

  it("builds without opening a network port", async () => {
    app = await buildTestApp();
    expect(app.server.listening).toBe(false);
  });

  it("returns liveness and security headers", async () => {
    app = await buildTestApp();
    const responses = await Promise.all(
      ["/health", "/health/live"].map((url) => app!.inject({ method: "GET", url })),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { status: "ok" } });
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("returns ready when all registered checks pass", async () => {
    app = await buildTestApp();
    app.healthService.registerReadinessCheck("example", () => Promise.resolve());

    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { status: "ready", checks: [{ name: "example", status: "up" }] },
    });
  });

  it("returns not ready without exposing readiness errors", async () => {
    app = await buildTestApp();
    app.healthService.registerReadinessCheck("database", () =>
      Promise.reject(new Error("sensitive connection details")),
    );

    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("sensitive connection details");
    expect(response.json()).toMatchObject({
      data: { status: "not_ready", checks: [{ name: "database", status: "down" }] },
    });
  });

  it("rejects invalid environment variables before creating the app", () => {
    expect(() => loadEnv({ ...TEST_ENV, PORT: "0" })).toThrowError(
      "Invalid environment configuration",
    );
    expect(() => loadEnv({ ...TEST_ENV, NODE_ENV: "production", DATABASE_URL: "" })).toThrowError(
      "Invalid environment configuration",
    );
  });

  it("uses Azure-compatible production host and local development defaults", () => {
    expect(loadEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://user:password@database.example/ilvox" }))
      .toMatchObject({ HOST: "0.0.0.0", PORT: 3001 });
    expect(loadEnv({ NODE_ENV: "development" })).toMatchObject({ HOST: "127.0.0.1", PORT: 3001 });
  });

  it("uses the standard safe error response", async () => {
    app = await buildTestApp();
    app.get("/test-error", () => {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Safe validation message",
        statusCode: 422,
        details: { field: "invalid" },
      });
    });

    const response = await app.inject({ method: "GET", url: "/test-error" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Safe validation message",
        details: { field: "invalid" },
      },
    });
    const body = response.json<{ error: { requestId: string } }>();
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("closes cleanly", async () => {
    app = await buildTestApp();
    await closeGracefully(app, "SIGTERM");
    app = undefined;
  });
});
