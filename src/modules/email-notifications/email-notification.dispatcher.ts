import type { FastifyBaseLogger } from "fastify";
import type { EmailProvider } from "./email-provider.js";
import type { EmailNotificationRepository } from "./email-notification.repository.js";
import { buildLeadCreatedEmail } from "./lead-created-email.js";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 10;

export interface NotificationDispatchTrigger {
  trigger(): void;
}

export class EmailNotificationDispatcher implements NotificationDispatchTrigger {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private rerunRequested = false;

  constructor(
    private readonly repository: EmailNotificationRepository,
    private readonly provider: EmailProvider,
    private readonly emailConfig: { readonly from: string; readonly frontendAppUrl: string },
    private readonly logger: Pick<FastifyBaseLogger, "error">,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (this.timer !== undefined) return;
    this.trigger();
    this.timer = setInterval(() => this.trigger(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  trigger(): void {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    void this.dispatchPending()
      .catch((error: unknown) => {
        this.logger.error({ err: error }, "Email notification dispatch failed");
      })
      .finally(() => {
        this.running = false;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.trigger();
        }
      });
  }

  async dispatchPending(): Promise<number> {
    let processed = 0;
    while (processed < this.batchSize) {
      const found = await this.repository.processNext(this.now(), async (notification) => {
        if (notification.eventType !== "lead.created") {
          return { outcome: "failed", errorCode: "unsupported_event_type" };
        }
        return this.provider.send(buildLeadCreatedEmail(notification, this.emailConfig));
      });
      if (!found) break;
      processed += 1;
    }
    return processed;
  }
}

