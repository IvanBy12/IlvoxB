import type { FastifyRequest } from "fastify";

export type SupportedClerkEventType = "user.created" | "user.updated" | "user.deleted";

export interface VerifiedClerkUserEvent {
  readonly type: SupportedClerkEventType;
  readonly occurredAt: Date;
  readonly clerkUserId: string;
  readonly primaryEmail?: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly avatarUrl?: string | null;
}

export interface ClerkWebhookVerifier {
  verify(rawBody: Buffer, request: FastifyRequest): Promise<VerifiedClerkUserEvent>;
}

export interface ClerkWebhookResult {
  readonly status: "processed" | "duplicate" | "obsolete";
  readonly eventId: string;
}

export interface ClerkWebhookProcessor {
  process(eventId: string, rawBody: Buffer, event: VerifiedClerkUserEvent): Promise<ClerkWebhookResult>;
}
