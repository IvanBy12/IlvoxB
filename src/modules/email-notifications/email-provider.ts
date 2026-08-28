export interface EmailMessage {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
  readonly idempotencyKey: string;
}

export type EmailSendResult =
  | { readonly outcome: "sent"; readonly providerMessageId: string }
  | { readonly outcome: "retry"; readonly errorCode: string; readonly retryAfterMs?: number }
  | { readonly outcome: "failed"; readonly errorCode: string };

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

