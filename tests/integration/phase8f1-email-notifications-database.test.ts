import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditContext } from "../../src/common/audit/audit.js";
import { DisabledEmailProvider } from "../../src/modules/email-notifications/disabled-email.provider.js";
import type { EmailMessage, EmailProvider, EmailSendResult } from "../../src/modules/email-notifications/email-provider.js";
import { PostgresEmailNotificationRepository } from "../../src/modules/email-notifications/email-notification.repository.js";
import { PostgresLeadRepository } from "../../src/modules/leads/lead.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

class FakeEmailProvider implements EmailProvider {
  readonly messages: string[] = [];
  constructor(private readonly results: EmailSendResult[]) {}
  send(message: EmailMessage): Promise<EmailSendResult> {
    this.messages.push(message.idempotencyKey);
    return Promise.resolve(this.results.shift() ?? { outcome: "sent", providerMessageId: "fake-default" });
  }
}

describe.skipIf(testDatabaseUrl === undefined)("Phase 8F.1 PostgreSQL email outbox", () => {
  const schema = `ilvox_phase8f1_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  let admin: pg.Client;
  let pool: Pool;
  let leads: PostgresLeadRepository;
  let notifications: PostgresEmailNotificationRepository;
  const audit = (): AuditContext => ({ requestId: randomUUID(), ipAddress: "127.0.0.1" });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quote(schema)}`);
    await admin.query(`SET search_path TO ${quote(schema)}, public`);
    await admin.query(readFileSync(resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"), "utf8"));
    const migration = readFileSync(resolve("drizzle", "migrations", "0014_phase8f1-email-notifications.sql"), "utf8")
      .replaceAll("--> statement-breakpoint", "")
      .replaceAll('"public".', `${quote(schema)}.`);
    await admin.query(migration);
    pool = new Pool({ connectionString: testDatabaseUrl, max: 6, options: `-c search_path=${schema},public` });
    leads = new PostgresLeadRepository(pool, { recipients: ["operator@example.test"], provider: "resend" });
    notifications = new PostgresEmailNotificationRepository(pool);
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query("RESET search_path").catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      await admin.end();
    }
  });

  async function createLead(source: "contact" | "diagnostic" = "contact") {
    return leads.createPublic({
      fullName: `Lead ${randomBytes(3).toString("hex")}`,
      email: `${randomBytes(5).toString("hex")}@example.test`,
      message: "Necesito una solución",
      source,
    }, audit());
  }

  function fakeMessage(idempotencyKey: string): EmailMessage {
    return {
      from: "ILVOX <notify@example.test>",
      to: ["operator@example.test"],
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
      idempotencyKey,
    };
  }

  it("creates the lead and one pending notification atomically for contact and diagnostic sources", async () => {
    for (const source of ["contact", "diagnostic"] as const) {
      const lead = await createLead(source);
      const state = await pool.query(
        "SELECT event_type,status,attempts FROM email_notifications WHERE lead_id=$1",
        [lead.id],
      );
      expect(state.rows).toEqual([{ event_type: "lead.created", status: "pending", attempts: 0 }]);
      await pool.query(
        `INSERT INTO email_notifications (lead_id,event_type,recipients,subject,provider)
         VALUES ($1,'lead.created',$2,'duplicate','resend') ON CONFLICT (event_type,lead_id) DO NOTHING`,
        [lead.id, ["operator@example.test"]],
      );
      expect((await pool.query<{ readonly count: number }>("SELECT count(*)::int AS count FROM email_notifications WHERE lead_id=$1", [lead.id])).rows[0]?.count).toBe(1);
      await pool.query("UPDATE email_notifications SET status='failed' WHERE lead_id=$1", [lead.id]);
    }
  });

  it("marks successful delivery sent and preserves a lead when the provider fails", async () => {
    const sentLead = await createLead();
    const sent = new FakeEmailProvider([{ outcome: "sent", providerMessageId: "fake-8f1" }]);
    expect(await notifications.processNext(new Date(), (item) => sent.send(fakeMessage(`${item.eventType}/${item.leadId}`)))).toBe(true);
    const sentState = await pool.query("SELECT status,attempts,provider_message_id FROM email_notifications WHERE lead_id=$1", [sentLead.id]);
    expect(sentState.rows[0]).toEqual({ status: "sent", attempts: 1, provider_message_id: "fake-8f1" });

    const failedLead = await createLead();
    const failed = new FakeEmailProvider([{ outcome: "failed", errorCode: "invalid_api_key" }]);
    expect(await notifications.processNext(new Date(), (item) => failed.send(fakeMessage(`${item.eventType}/${item.leadId}`)))).toBe(true);
    expect((await pool.query("SELECT 1 FROM leads WHERE id=$1", [failedLead.id])).rowCount).toBe(1);
    expect((await pool.query("SELECT status,last_error FROM email_notifications WHERE lead_id=$1", [failedLead.id])).rows[0])
      .toEqual({ status: "failed", last_error: "invalid_api_key" });
  });

  it("backs off transient failures and becomes failed at three attempts", async () => {
    const lead = await createLead();
    const provider = new FakeEmailProvider([
      { outcome: "retry", errorCode: "rate_limit_exceeded", retryAfterMs: 120_000 },
      { outcome: "retry", errorCode: "provider_timeout" },
      { outcome: "retry", errorCode: "provider_timeout" },
    ]);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await pool.query("UPDATE email_notifications SET next_attempt_at=now() - interval '1 second' WHERE lead_id=$1", [lead.id]);
      expect(await notifications.processNext(new Date(), (item) => provider.send(fakeMessage(`${item.eventType}/${item.leadId}`)))).toBe(true);
      const state = (await pool.query<{
        readonly status: string;
        readonly attempts: number;
        readonly next_attempt_at: Date;
      }>("SELECT status,attempts,next_attempt_at FROM email_notifications WHERE lead_id=$1", [lead.id])).rows[0]!;
      expect(state.attempts).toBe(attempt);
      expect(state.status).toBe(attempt === 3 ? "failed" : "pending");
      if (attempt === 1) expect(new Date(state.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 100_000);
    }
    expect(new Set(provider.messages)).toEqual(new Set([`lead.created/${lead.id}`]));
  });

  it("uses row locking so concurrent processors make one logical send", async () => {
    const lead = await createLead();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    let sends = 0;
    const first = notifications.processNext(new Date(), async () => {
      sends += 1;
      entered();
      await gate;
      return { outcome: "sent", providerMessageId: "fake-concurrent" };
    });
    await enteredGate;
    const second = notifications.processNext(new Date(), () => {
      sends += 1;
      return Promise.resolve({ outcome: "sent", providerMessageId: "should-not-send" });
    });
    expect(await second).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(sends).toBe(1);
    expect((await pool.query<{ readonly status: string }>("SELECT status FROM email_notifications WHERE lead_id=$1", [lead.id])).rows[0]?.status).toBe("sent");
  });

  it("lets a disabled provider fail the notification without rolling back the lead", async () => {
    const lead = await createLead();
    const disabled = new DisabledEmailProvider();
    await notifications.processNext(new Date(), (item) => disabled.send(fakeMessage(`${item.eventType}/${item.leadId}`)));
    expect((await pool.query("SELECT 1 FROM leads WHERE id=$1", [lead.id])).rowCount).toBe(1);
    expect((await pool.query<{ readonly status: string }>("SELECT status FROM email_notifications WHERE lead_id=$1", [lead.id])).rows[0]?.status).toBe("failed");
  });
});
