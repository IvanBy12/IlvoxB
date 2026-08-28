import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { insertAuditEvent } from "../../common/audit/audit.js";
import type { EmailSendResult } from "./email-provider.js";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 300_000, 1_800_000] as const;

export interface PendingEmailNotification {
  readonly id: string;
  readonly leadId: string;
  readonly eventType: "lead.created";
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly provider: "disabled" | "resend";
  readonly attempts: number;
  readonly fullName: string;
  readonly companyName: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly serviceName: string | null;
  readonly message: string;
  readonly source: string;
  readonly leadCreatedAt: Date;
}

interface NotificationRow {
  readonly id: string;
  readonly lead_id: string;
  readonly event_type: "lead.created";
  readonly recipients: string[];
  readonly subject: string;
  readonly provider: "disabled" | "resend";
  readonly attempts: number;
  readonly full_name: string;
  readonly company_name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly service_name: string | null;
  readonly message: string;
  readonly source: string;
  readonly lead_created_at: Date;
}

function mapNotification(row: NotificationRow): PendingEmailNotification {
  return {
    id: row.id,
    leadId: row.lead_id,
    eventType: row.event_type,
    recipients: row.recipients,
    subject: row.subject,
    provider: row.provider,
    attempts: row.attempts,
    fullName: row.full_name,
    companyName: row.company_name,
    email: row.email,
    phone: row.phone,
    serviceName: row.service_name,
    message: row.message,
    source: row.source,
    leadCreatedAt: row.lead_created_at,
  };
}

function safeErrorCode(value: string): string {
  return /^[a-z0-9_.-]{1,160}$/u.test(value) ? value : "provider_error";
}

async function finalize(
  client: PoolClient,
  notification: PendingEmailNotification,
  result: EmailSendResult,
  now: Date,
): Promise<void> {
  const attempt = notification.attempts + 1;
  if (result.outcome === "sent") {
    await client.query(
      `UPDATE email_notifications
       SET status='sent', attempts=$2, provider_message_id=$3, last_error=NULL,
           sent_at=$4, updated_at=$4
       WHERE id=$1`,
      [notification.id, attempt, result.providerMessageId.slice(0, 200), now],
    );
    await insertAuditEvent(client, {
      requestId: randomUUID(),
      action: "email_notification.sent",
      entityType: "email_notification",
      entityId: notification.id,
      newValues: { leadId: notification.leadId, provider: notification.provider, attempts: attempt },
    });
    return;
  }

  const errorCode = safeErrorCode(result.errorCode);
  const terminal = result.outcome === "failed" || attempt >= MAX_ATTEMPTS;
  if (terminal) {
    await client.query(
      `UPDATE email_notifications
       SET status='failed', attempts=$2, last_error=$3, next_attempt_at=$4, updated_at=$4
       WHERE id=$1`,
      [notification.id, attempt, errorCode, now],
    );
    await insertAuditEvent(client, {
      requestId: randomUUID(),
      action: "email_notification.failed",
      entityType: "email_notification",
      entityId: notification.id,
      newValues: { leadId: notification.leadId, provider: notification.provider, attempts: attempt, errorCode },
    });
    return;
  }

  const baseDelay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)!;
  const delay = Math.min(Math.max(baseDelay, result.retryAfterMs ?? 0), 86_400_000);
  await client.query(
    `UPDATE email_notifications
     SET attempts=$2, last_error=$3, next_attempt_at=$4, updated_at=$5
     WHERE id=$1`,
    [notification.id, attempt, errorCode, new Date(now.getTime() + delay), now],
  );
}

export interface EmailNotificationRepository {
  processNext(
    now: Date,
    send: (notification: PendingEmailNotification) => Promise<EmailSendResult>,
    notificationId?: string,
  ): Promise<boolean>;
}

export class PostgresEmailNotificationRepository implements EmailNotificationRepository {
  constructor(private readonly pool: Pool) {}

  async processNext(
    now: Date,
    send: (notification: PendingEmailNotification) => Promise<EmailSendResult>,
    notificationId?: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<NotificationRow>(
        `SELECT n.id, n.lead_id, n.event_type, n.recipients, n.subject, n.provider, n.attempts,
                l.full_name, l.company_name, l.email, l.phone, s.name AS service_name,
                l.message, l.source, l.created_at AS lead_created_at
         FROM email_notifications n
         JOIN leads l ON l.id=n.lead_id
         LEFT JOIN services s ON s.id=l.service_id
         WHERE n.status='pending' AND n.attempts < $1 AND n.next_attempt_at <= $2
           AND ($3::uuid IS NULL OR n.id=$3)
         ORDER BY n.next_attempt_at ASC, n.created_at ASC
         FOR UPDATE OF n SKIP LOCKED
         LIMIT 1`,
        [MAX_ATTEMPTS, now, notificationId ?? null],
      );
      const row = selected.rows[0];
      if (row === undefined) {
        await client.query("COMMIT");
        return false;
      }

      const notification = mapNotification(row);
      let result: EmailSendResult;
      try {
        result = await send(notification);
      } catch {
        result = { outcome: "retry", errorCode: "provider_unhandled_error" };
      }
      await finalize(client, notification, result, now);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
