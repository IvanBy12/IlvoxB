import { describe, expect, it, vi } from "vitest";
import { DisabledEmailProvider } from "../../src/modules/email-notifications/disabled-email.provider.js";
import { EmailNotificationDispatcher } from "../../src/modules/email-notifications/email-notification.dispatcher.js";
import type { EmailMessage, EmailProvider } from "../../src/modules/email-notifications/email-provider.js";
import type { EmailNotificationRepository, PendingEmailNotification } from "../../src/modules/email-notifications/email-notification.repository.js";
import { buildLeadCreatedEmail } from "../../src/modules/email-notifications/lead-created-email.js";
import { ResendEmailProvider } from "../../src/modules/email-notifications/resend-email.provider.js";

const notification: PendingEmailNotification = {
  id: "10000000-0000-4000-8000-000000008f01",
  leadId: "10000000-0000-4000-8000-000000008f02",
  eventType: "lead.created",
  recipients: ["operator@example.test"],
  subject: "Nuevo prospecto en ILVOX — Empresa",
  provider: "resend",
  attempts: 0,
  fullName: '<img src=x onerror="alert(1)">',
  companyName: "Empresa & socios",
  email: "lead@example.test",
  phone: "+57 <script>",
  serviceName: "Diseño > web",
  message: "Necesito <b>ayuda</b> & orientación",
  source: "diagnostic",
  leadCreatedAt: new Date("2026-08-28T12:00:00.000Z"),
};

function message(): EmailMessage {
  return buildLeadCreatedEmail(notification, {
    from: "ILVOX <notify@example.test>",
    frontendAppUrl: "http://127.0.0.1:5173/base",
  });
}

describe("transactional email providers and lead template", () => {
  it("escapes every external lead field and builds the real server-side CTA", () => {
    const built = message();
    expect(built.html).not.toContain("<img src=x");
    expect(built.html).not.toContain("<script>");
    expect(built.html).not.toContain("<b>ayuda</b>");
    expect(built.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(built.html).toContain("Empresa &amp; socios");
    expect(built.html).toContain(`/app/prospectos/${notification.leadId}`);
    expect(built.idempotencyKey).toBe(`lead.created/${notification.leadId}`);
  });

  it("uses a validated lead email as Reply-To and omits malformed input", () => {
    expect(message().replyTo).toBe("lead@example.test");
    const malformed = buildLeadCreatedEmail({ ...notification, email: "victim@example.test\r\nBcc: attacker@example.test" }, {
      from: "ILVOX <notify@example.test>", frontendAppUrl: "http://127.0.0.1:5173",
    });
    expect(malformed.replyTo).toBeUndefined();
  });

  it("maps Resend success, transient failures, and permanent failures without leaking provider details", async () => {
    const successFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ id: "email_123" }), { status: 200 })));
    await expect(new ResendEmailProvider("secret-key", successFetch).send(message())).resolves.toEqual({
      outcome: "sent", providerMessageId: "email_123",
    });
    const request = successFetch.mock.calls[0]!;
    expect(request[0]).toBe("https://api.resend.com/emails");
    expect((request[1]?.headers as Record<string, string>)["idempotency-key"]).toBe(`lead.created/${notification.leadId}`);
    const requestBody = request[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody === "string") expect(requestBody).not.toContain("secret-key");

    const limited = vi.fn<typeof fetch>(() => Promise.resolve(new Response(
      JSON.stringify({ name: "rate_limit_exceeded", message: "quota details secret-key" }),
      { status: 429, headers: { "retry-after": "120" } },
    )));
    const retry = await new ResendEmailProvider("secret-key", limited).send(message());
    expect(retry).toEqual({ outcome: "retry", errorCode: "rate_limit_exceeded", retryAfterMs: 120_000 });
    expect(JSON.stringify(retry)).not.toContain("secret-key");
    expect(JSON.stringify(retry)).not.toContain("quota details");

    const rejected = vi.fn<typeof fetch>(() => Promise.resolve(new Response(
      JSON.stringify({ name: "invalid_api_key", message: "secret-key" }), { status: 403 },
    )));
    await expect(new ResendEmailProvider("secret-key", rejected).send(message())).resolves.toEqual({
      outcome: "failed", errorCode: "authentication_or_domain_rejected",
    });
  });

  it("keeps disabled environments functional without making network calls", async () => {
    await expect(new DisabledEmailProvider().send(message())).resolves.toEqual({
      outcome: "failed", errorCode: "provider_disabled",
    });
  });

  it("dispatches a lead.created notification through the EmailProvider port", async () => {
    let available = true;
    const repository: EmailNotificationRepository = {
      processNext: async (_now, send) => {
        if (!available) return false;
        available = false;
        await send(notification);
        return true;
      },
    };
    const provider = {
      send: vi.fn<EmailProvider["send"]>(() => Promise.resolve({ outcome: "sent", providerMessageId: "fake-dispatch" })),
    };
    const dispatcher = new EmailNotificationDispatcher(
      repository,
      provider,
      { from: "ILVOX <notify@example.test>", frontendAppUrl: "http://127.0.0.1:5173" },
      { error: vi.fn() },
    );
    await expect(dispatcher.dispatchPending()).resolves.toBe(1);
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.send.mock.calls[0]![0]).toMatchObject({
      idempotencyKey: `lead.created/${notification.leadId}`,
      replyTo: notification.email,
    });
  });
});
