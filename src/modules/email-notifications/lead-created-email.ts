import { z } from "zod";
import type { EmailMessage } from "./email-provider.js";
import type { PendingEmailNotification } from "./email-notification.repository.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function validReplyTo(value: string): boolean {
  return !/[\r\n]/u.test(value) && z.email().safeParse(value).success;
}

function row(label: string, value: string | null): string {
  if (value === null || value.length === 0) return "";
  return `<tr><td style="padding:8px 12px;color:#667085;font-size:13px;vertical-align:top;width:32%">${escapeHtml(label)}</td>` +
    `<td style="padding:8px 12px;color:#101828;font-size:14px;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`;
}

function sourceLabel(value: string): string {
  return ({ diagnostic: "Diagnóstico", quotation: "Cotización", contact: "Contacto", referral: "Referido", campaign: "Campaña" } as Record<string, string>)[value] ?? value;
}

export function buildLeadCreatedEmail(
  notification: PendingEmailNotification,
  input: { readonly from: string; readonly frontendAppUrl: string },
): EmailMessage {
  const ctaUrl = new URL(`/app/prospectos/${notification.leadId}`, input.frontendAppUrl).toString();
  const needAndSource = notification.serviceName === null
    ? sourceLabel(notification.source)
    : `${notification.serviceName} · ${sourceLabel(notification.source)}`;
  const date = notification.leadCreatedAt.toISOString();
  const html = `<!doctype html><html><body style="margin:0;background:#f2f4f7;font-family:Arial,sans-serif;color:#101828">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #eaecf0;border-radius:12px;overflow:hidden">
<tr><td style="padding:28px 28px 12px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#6941c6">ILVOX</div><h1 style="margin:8px 0 0;font-size:24px;line-height:1.3">Nuevo prospecto en ILVOX</h1></td></tr>
<tr><td style="padding:8px 16px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
${row("Nombre", notification.fullName)}${row("Empresa", notification.companyName)}${row("Correo", notification.email)}${row("Teléfono", notification.phone)}${row("Necesidad / fuente", needAndSource)}${row("Mensaje", notification.message)}${row("Fecha", date)}
</table></td></tr>
<tr><td style="padding:0 28px 30px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#6941c6;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px">Ver prospecto en ILVOX</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    "Nuevo prospecto en ILVOX",
    `Nombre: ${notification.fullName}`,
    notification.companyName === null ? null : `Empresa: ${notification.companyName}`,
    `Correo: ${notification.email}`,
    notification.phone === null ? null : `Teléfono: ${notification.phone}`,
    `Necesidad / fuente: ${needAndSource}`,
    `Mensaje: ${notification.message}`,
    `Fecha: ${date}`,
    `Ver prospecto en ILVOX: ${ctaUrl}`,
  ].filter((value): value is string => value !== null).join("\n");

  return {
    from: input.from,
    to: notification.recipients,
    subject: notification.subject,
    html,
    text,
    ...(validReplyTo(notification.email) ? { replyTo: notification.email } : {}),
    idempotencyKey: `lead.created/${notification.leadId}`,
  };
}

