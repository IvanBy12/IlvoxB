import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app.js";

const LOCAL_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
] as const;
const DISALLOWED_ORIGIN = "https://attacker.example";

describe("local CORS contract", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
  });

  it.each(LOCAL_ORIGINS)("allows the local origin %s", async (origin) => {
    app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { origin },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-expose-headers"]?.toLowerCase()).toContain(
      "retry-after",
    );
    expect(response.headers["access-control-expose-headers"]?.toLowerCase()).toContain(
      "x-request-id",
    );
  });

  it("does not grant CORS to an external origin", async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { origin: DISALLOWED_ORIGIN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each(LOCAL_ORIGINS)(
    "allows Authorization in preflight for the local origin %s",
    async (origin) => {
      app = await buildTestApp();
      const response = await app.inject({
        method: "OPTIONS",
        url: "/me",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toContain(
        "authorization",
      );
    },
  );
});
