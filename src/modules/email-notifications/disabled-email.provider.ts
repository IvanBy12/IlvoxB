import type { EmailMessage, EmailProvider, EmailSendResult } from "./email-provider.js";

export class DisabledEmailProvider implements EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult> {
    void message;
    return Promise.resolve({ outcome: "failed", errorCode: "provider_disabled" });
  }
}
