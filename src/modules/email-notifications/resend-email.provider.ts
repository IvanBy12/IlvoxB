import type { EmailMessage, EmailProvider, EmailSendResult } from "./email-provider.js";

type Fetch = typeof fetch;

interface ResendErrorBody {
  readonly name?: unknown;
  readonly type?: unknown;
}

function errorType(body: ResendErrorBody): string | undefined {
  const value = typeof body.name === "string" ? body.name : body.type;
  return typeof value === "string" && /^[a-z0-9_]{1,80}$/u.test(value) ? value : undefined;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 86_400_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(date - Date.now(), 0), 86_400_000);
}

function permanentCode(status: number, type: string | undefined): string {
  if (status === 401) return "authentication_required";
  if (status === 403) return "authentication_or_domain_rejected";
  if (status === 409) return type ?? "idempotency_conflict";
  if (status === 422) return type ?? "invalid_email_request";
  return type ?? `provider_http_${status}`;
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImplementation: Fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await this.fetchImplementation("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey,
          "user-agent": "ilvox-backend/0.1.0",
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const body = await response.json().catch(() => ({})) as ResendErrorBody & { readonly id?: unknown };
      if (response.ok) {
        return typeof body.id === "string" && body.id.length > 0
          ? { outcome: "sent", providerMessageId: body.id }
          : { outcome: "retry", errorCode: "invalid_provider_response" };
      }

      const type = errorType(body);
      if (response.status === 429 || response.status >= 500 ||
          (response.status === 409 && type === "concurrent_idempotent_requests")) {
        const delay = retryAfterMs(response);
        return {
          outcome: "retry",
          errorCode: type ?? `provider_http_${response.status}`,
          ...(delay === undefined ? {} : { retryAfterMs: delay }),
        };
      }
      return { outcome: "failed", errorCode: permanentCode(response.status, type) };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return {
        outcome: "retry",
        errorCode: name === "AbortError" || name === "TimeoutError" ? "provider_timeout" : "provider_network_error",
      };
    }
  }
}

