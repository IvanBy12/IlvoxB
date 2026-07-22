import { sql } from "drizzle-orm";
import { char, check, index, integer, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    clerkUserId: varchar("clerk_user_id", { length: 255 }).notNull(),
    primaryEmail: varchar("primary_email", { length: 320 }).notNull(),
    firstName: varchar("first_name", { length: 120 }),
    lastName: varchar("last_name", { length: 120 }),
    avatarUrl: text("avatar_url"),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "active", "blocked", "deleted"],
    })
      .notNull()
      .default("pending"),
    lastSyncedAt: timestampWithTimezone("last_synced_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("app_users_clerk_user_id_key").on(table.clerkUserId),
    check(
      "chk_app_users_clerk_user_id_not_blank",
      sql`btrim(${table.clerkUserId}) <> ''`,
    ),
    check(
      "chk_app_users_primary_email_not_blank",
      sql`btrim(${table.primaryEmail}) <> ''`,
    ),
    check(
      "chk_app_users_status",
      sql`${table.status} IN ('pending', 'active', 'blocked', 'deleted')`,
    ),
    index("idx_app_users_primary_email_lower").on(sql`lower(${table.primaryEmail})`),
    index("idx_app_users_status").on(table.status),
  ],
);

export const identityWebhookEvents = pgTable(
  "identity_webhook_events",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    clerkEventId: varchar("clerk_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    clerkOccurredAt: timestampWithTimezone("clerk_occurred_at").notNull(),
    receivedAt: timestampWithTimezone("received_at").notNull().defaultNow(),
    status: varchar("status", {
      length: 20,
      enum: ["received", "processing", "processed", "failed"],
    })
      .notNull()
      .default("received"),
    attemptCount: integer("attempt_count").notNull().default(0),
    payloadSha256: char("payload_sha256", { length: 64 }).notNull(),
    processedAt: timestampWithTimezone("processed_at"),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorRedacted: text("last_error_redacted"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("identity_webhook_events_clerk_event_id_key").on(table.clerkEventId),
    check(
      "chk_identity_webhook_events_status",
      sql`${table.status} IN ('received', 'processing', 'processed', 'failed')`,
    ),
    check(
      "chk_identity_webhook_events_attempt_count",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "chk_identity_webhook_events_payload_sha256",
      sql`${table.payloadSha256} ~ '^[0-9A-Fa-f]{64}$'`,
    ),
    check(
      "chk_identity_webhook_events_processed_at",
      sql`(
        (${table.status} = 'processed' AND ${table.processedAt} IS NOT NULL)
        OR
        (${table.status} <> 'processed' AND ${table.processedAt} IS NULL)
      )`,
    ),
    index("idx_identity_webhook_events_work_queue").on(table.status, table.createdAt),
  ],
);
