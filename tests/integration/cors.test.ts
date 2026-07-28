import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
const DISALLOWED_ORIGIN = "http://localhost:5173";

describe("local CORS contract", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
  });

  it("allows the canonical local origin", async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant CORS to a different local origin", async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { origin: DISALLOWED_ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows Authorization in preflight for the canonical origin", async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/me",
      headers: {
        origin: ALLOWED_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toContain(
      "authorization",
    );
  });
});
