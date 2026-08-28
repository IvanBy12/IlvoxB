import "dotenv/config";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../src/config/env.js";
import { createDatabaseClient } from "../src/db/client.js";
import { PostgresEmailNotificationRepository } from "../src/modules/email-notifications/email-notification.repository.js";
import { buildLeadCreatedEmail } from "../src/modules/email-notifications/lead-created-email.js";
import { ResendEmailProvider } from "../src/modules/email-notifications/resend-email.provider.js";
import { PostgresLeadRepository } from "../src/modules/leads/lead.repository.js";

const config = loadEnv();
if (config.EMAIL_PROVIDER !== "resend" || config.RESEND_API_KEY === undefined ||
    config.EMAIL_FROM === undefined || config.NOTIFICATION_EMAIL_TO.length === 0 ||
    config.DATABASE_URL === undefined) {
  console.log("PHASE8F1_RESEND_SMOKE_SKIPPED_CONFIGURATION_MISSING");
  process.exitCode = 0;
} else {
  const database = createDatabaseClient({ ...config, DATABASE_URL: config.DATABASE_URL });
  let leadId: string | undefined;
  let notificationId: string | undefined;
  let residualNonzero = false;
  try {
    const leads = new PostgresLeadRepository(database.pool, {
      recipients: config.NOTIFICATION_EMAIL_TO,
      provider: "resend",
    });
    const lead = await leads.createPublic({
      fullName: `PHASE8F1_RESEND_SMOKE_${randomUUID().slice(0, 8)}`,
      email: "phase8f1-smoke@example.test",
      message: "Prueba transaccional controlada de Resend.",
      source: "contact",
    }, { requestId: randomUUID(), ipAddress: "127.0.0.1", userAgent: "phase8f1-resend-smoke" });
    leadId = lead.id;
    const row = await database.pool.query<{ readonly id: string }>(
      "SELECT id FROM email_notifications WHERE lead_id=$1 AND event_type='lead.created'",
      [lead.id],
    );
    notificationId = row.rows[0]?.id;
    if (notificationId === undefined) throw new Error("PHASE8F1_RESEND_SMOKE_NOTIFICATION_MISSING");

    const repository = new PostgresEmailNotificationRepository(database.pool);
    const provider = new ResendEmailProvider(config.RESEND_API_KEY);
    const processed = await repository.processNext(new Date(), (notification) => provider.send(
      buildLeadCreatedEmail(notification, {
        from: config.EMAIL_FROM!,
        frontendAppUrl: config.CLIENT_APP_URL ?? config.CORS_ORIGINS[0]!,
      }),
    ), notificationId);
    if (!processed) throw new Error("PHASE8F1_RESEND_SMOKE_NOT_PROCESSED");
    const state = await database.pool.query<{ readonly status: string; readonly provider_message_id: string | null }>(
      "SELECT status,provider_message_id FROM email_notifications WHERE id=$1",
      [notificationId],
    );
    if (state.rows[0]?.status !== "sent" || state.rows[0].provider_message_id === null) {
      throw new Error("PHASE8F1_RESEND_SMOKE_NOT_SENT");
    }
    console.log("PHASE8F1_RESEND_SMOKE_SENT_WITH_PROVIDER_ID");
  } finally {
    if (notificationId !== undefined) {
      await database.pool.query("DELETE FROM audit_events WHERE entity_type='email_notification' AND entity_id=$1", [notificationId]);
    }
    if (leadId !== undefined) {
      await database.pool.query("DELETE FROM email_notifications WHERE lead_id=$1", [leadId]);
      await database.pool.query("DELETE FROM audit_events WHERE entity_type='lead' AND entity_id=$1", [leadId]);
      await database.pool.query("DELETE FROM leads WHERE id=$1", [leadId]);
      const residual = await database.pool.query<{ readonly count: number }>(
        `SELECT (SELECT count(*) FROM leads WHERE id=$1)::int +
                (SELECT count(*) FROM email_notifications WHERE lead_id=$1)::int AS count`,
        [leadId],
      );
      residualNonzero = residual.rows[0]?.count !== 0;
    }
    await database.pool.end();
  }
  if (residualNonzero) throw new Error("PHASE8F1_RESEND_SMOKE_RESIDUAL_NONZERO");
  console.log("PHASE8F1_RESEND_SMOKE_RESIDUAL_0");
}
