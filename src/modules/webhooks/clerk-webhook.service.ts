import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ClerkWebhookProcessor, ClerkWebhookResult, VerifiedClerkUserEvent } from "./clerk-webhook.types.js";

interface EventRow {
  readonly event_type: string;
  readonly status: "received" | "processing" | "processed" | "failed";
  readonly payload_sha256: string;
}

export class ClerkWebhookService implements ClerkWebhookProcessor {
  constructor(private readonly pool: Pool) {}

  async process(eventId: string, rawBody: Buffer, event: VerifiedClerkUserEvent): Promise<ClerkWebhookResult> {
    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serializes both first delivery and concurrent retries before the unique
      // event row exists, avoiding a race that would otherwise surface as 503.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [eventId]);
      const existing = await client.query<EventRow>(
        `SELECT event_type, status, payload_sha256 FROM identity_webhook_events
         WHERE clerk_event_id=$1 FOR UPDATE`, [eventId],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (prior.event_type !== event.type || prior.payload_sha256 !== payloadSha256) {
          throw new Error("WEBHOOK_EVENT_COLLISION");
        }
        if (prior.status === "processed") {
          await client.query("COMMIT");
          return { status: "duplicate", eventId };
        }
        await client.query(
          `UPDATE identity_webhook_events SET status='processing', attempt_count=attempt_count+1,
             last_error_code=NULL, last_error_redacted=NULL, updated_at=now()
           WHERE clerk_event_id=$1`, [eventId],
        );
      } else {
        await client.query(
          `INSERT INTO identity_webhook_events
             (clerk_event_id,event_type,clerk_occurred_at,received_at,status,attempt_count,payload_sha256)
           VALUES ($1,$2,$3,now(),'processing',1,$4)`,
          [eventId, event.type, event.occurredAt, payloadSha256],
        );
      }

      const applied = await this.applyUserEvent(client, event);
      await client.query(
        `UPDATE identity_webhook_events SET status='processed', processed_at=now(),
           last_error_code=NULL, last_error_redacted=NULL, updated_at=now()
         WHERE clerk_event_id=$1`, [eventId],
      );
      await client.query("COMMIT");
      return { status: applied ? "processed" : "obsolete", eventId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      try {
        await this.recordFailure(eventId, payloadSha256, event);
      } catch (recordingError) {
        throw new AggregateError(
          [error, recordingError],
          "WEBHOOK_FAILURE_RECORDING_FAILED",
          { cause: recordingError },
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyUserEvent(client: PoolClient, event: VerifiedClerkUserEvent): Promise<boolean> {
    const current = await client.query<{ readonly last_synced_at: Date | null }>(
      "SELECT last_synced_at FROM app_users WHERE clerk_user_id=$1 FOR UPDATE", [event.clerkUserId],
    );
    const lastSyncedAt = current.rows[0]?.last_synced_at;
    if (lastSyncedAt !== undefined && lastSyncedAt !== null && lastSyncedAt > event.occurredAt) return false;

    if (event.type === "user.deleted") {
      await client.query(
        `INSERT INTO app_users (clerk_user_id,primary_email,status,last_synced_at)
         VALUES ($1,$2,'deleted',$3)
         ON CONFLICT (clerk_user_id) DO UPDATE SET
           status='deleted', last_synced_at=EXCLUDED.last_synced_at, updated_at=now()
         WHERE app_users.last_synced_at IS NULL OR app_users.last_synced_at <= EXCLUDED.last_synced_at`,
        [event.clerkUserId,
          `deleted+${createHash("sha256").update(event.clerkUserId).digest("hex").slice(0, 32)}@deleted.invalid`,
          event.occurredAt],
      );
      return true;
    }

    await client.query(
      `INSERT INTO app_users
         (clerk_user_id,primary_email,first_name,last_name,avatar_url,status,last_synced_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         primary_email=EXCLUDED.primary_email, first_name=EXCLUDED.first_name,
         last_name=EXCLUDED.last_name, avatar_url=EXCLUDED.avatar_url,
         last_synced_at=EXCLUDED.last_synced_at, updated_at=now()
       WHERE app_users.last_synced_at IS NULL OR app_users.last_synced_at <= EXCLUDED.last_synced_at`,
      [event.clerkUserId, event.primaryEmail, event.firstName ?? null,
        event.lastName ?? null, event.avatarUrl ?? null, event.occurredAt],
    );
    return true;
  }

  private async recordFailure(
    eventId: string,
    payloadSha256: string,
    event: VerifiedClerkUserEvent,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO identity_webhook_events
         (clerk_event_id,event_type,clerk_occurred_at,received_at,status,attempt_count,
          payload_sha256,last_error_code,last_error_redacted)
       VALUES ($1,$2,$3,now(),'failed',1,$4,'PROCESSING_FAILED','Webhook processing failed')
       ON CONFLICT (clerk_event_id) DO UPDATE SET
         status=CASE WHEN identity_webhook_events.status='processed' THEN 'processed' ELSE 'failed' END,
         attempt_count=identity_webhook_events.attempt_count+1,
         last_error_code=CASE WHEN identity_webhook_events.status='processed' THEN NULL ELSE 'PROCESSING_FAILED' END,
         last_error_redacted=CASE WHEN identity_webhook_events.status='processed' THEN NULL ELSE 'Webhook processing failed' END,
         updated_at=now()`,
      [eventId, event.type, event.occurredAt, payloadSha256],
    );
  }
}
