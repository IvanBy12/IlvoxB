import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { OfficialClerkWebhookVerifier } from "../../src/modules/webhooks/clerk-webhook.verifier.js";
import type { ClerkWebhookProcessor, ClerkWebhookResult } from "../../src/modules/webhooks/clerk-webhook.types.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const secret = `whsec_${key.toString("base64")}`;
const messageId = "msg_phase3_valid";

function signedHeaders(payload: string, valid = true): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key)
    .update(`${messageId}.${timestamp}.${payload}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${valid ? signature : "invalid"}`,
  };
}

function payload(): string {
  return JSON.stringify({
    object: "event",
    type: "user.created",
    timestamp: Date.now(),
    data: {
      id: "user_clerk_phase3",
      primary_email_address_id: "email_primary",
      email_addresses: [{ id: "email_primary", email_address: "phase3@example.test" }],
      first_name: "Phase",
      last_name: "Three",
      image_url: null,
    },
  });
}

describe("official Clerk webhook verification", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app !== undefined) await app.close(); app = undefined; });

  it("accepts a valid signature and preserves the exact raw payload", async () => {
    const raw = payload();
    let observed = "";
    const processor: ClerkWebhookProcessor = {
      process: (eventId, body): Promise<ClerkWebhookResult> => {
        observed = body.toString("utf8");
        return Promise.resolve({ status: "processed", eventId });
      },
    };
    app = await buildTestApp({}, {
      webhookVerifier: new OfficialClerkWebhookVerifier(secret), webhookProcessor: processor,
    });
    const response = await app.inject({ method: "POST", url: "/webhooks/clerk",
      headers: signedHeaders(raw), payload: raw });
    expect(response.statusCode).toBe(200);
    expect(observed).toBe(raw);
  });

  it("rejects an invalid signature", async () => {
    const raw = payload();
    const processor: ClerkWebhookProcessor = {
      process: () => Promise.resolve({ status: "processed", eventId: messageId }),
    };
    app = await buildTestApp({}, {
      webhookVerifier: new OfficialClerkWebhookVerifier(secret), webhookProcessor: processor,
    });
    expect((await app.inject({ method: "POST", url: "/webhooks/clerk",
      headers: signedHeaders(raw, false), payload: raw })).statusCode).toBe(400);
  });

  it("rejects an altered payload and missing signature headers", async () => {
    const raw = payload();
    const processor: ClerkWebhookProcessor = {
      process: () => Promise.resolve({ status: "processed", eventId: messageId }),
    };
    app = await buildTestApp({}, {
      webhookVerifier: new OfficialClerkWebhookVerifier(secret), webhookProcessor: processor,
    });
    const altered = `${raw} `;
    expect((await app.inject({ method: "POST", url: "/webhooks/clerk",
      headers: signedHeaders(raw), payload: altered })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/webhooks/clerk",
      headers: { "content-type": "application/json" }, payload: raw })).statusCode).toBe(400);
  });
});
