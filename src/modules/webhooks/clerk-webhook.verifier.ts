import { verifyWebhook } from "@clerk/backend/webhooks";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { ClerkWebhookVerifier, VerifiedClerkUserEvent } from "./clerk-webhook.types.js";

const emailSchema = z.object({ id: z.string(), email_address: z.email() });
const activeUserSchema = z.object({
  id: z.string().min(1),
  primary_email_address_id: z.string().nullable().optional(),
  email_addresses: z.array(emailSchema),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  image_url: z.url().nullable().optional(),
});
const deletedUserSchema = z.object({ id: z.string().min(1) });
const envelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user.created"), timestamp: z.number(), data: activeUserSchema }),
  z.object({ type: z.literal("user.updated"), timestamp: z.number(), data: activeUserSchema }),
  z.object({ type: z.literal("user.deleted"), timestamp: z.number(), data: deletedUserSchema }),
]);

export class OfficialClerkWebhookVerifier implements ClerkWebhookVerifier {
  constructor(private readonly signingSecret: string) {}

  async verify(rawBody: Buffer, request: FastifyRequest): Promise<VerifiedClerkUserEvent> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
    const url = `${request.protocol}://${request.hostname || "localhost"}${request.url}`;
    await verifyWebhook(new Request(url, {
      method: "POST",
      headers,
      body: new Uint8Array(rawBody),
    }), { signingSecret: this.signingSecret });
    // The official helper verifies the exact request body but intentionally
    // normalizes its return value and omits the source event timestamp. Parse
    // only after successful verification so ordering uses Clerk's timestamp.
    const event = envelopeSchema.parse(JSON.parse(rawBody.toString("utf8")));
    if (event.type === "user.deleted") {
      return { type: event.type, occurredAt: new Date(event.timestamp), clerkUserId: event.data.id };
    }
    const primary = event.data.email_addresses.find((email) =>
      email.id === event.data.primary_email_address_id) ?? event.data.email_addresses[0];
    if (primary === undefined) throw new Error("Clerk user event has no email address");
    return {
      type: event.type,
      occurredAt: new Date(event.timestamp),
      clerkUserId: event.data.id,
      primaryEmail: primary.email_address,
      firstName: event.data.first_name ?? null,
      lastName: event.data.last_name ?? null,
      avatarUrl: event.data.image_url ?? null,
    };
  }
}
