import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { leads } from "./leads.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const emailNotifications = pgTable(
  "email_notifications",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    leadId: uuid("lead_id").notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    recipients: text("recipients").array().notNull(),
    subject: varchar("subject", { length: 300 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "sent", "failed"],
    }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    provider: varchar("provider", { length: 30, enum: ["disabled", "resend"] }).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 200 }),
    lastError: varchar("last_error", { length: 160 }),
    nextAttemptAt: timestampWithTimezone("next_attempt_at").notNull().defaultNow(),
    sentAt: timestampWithTimezone("sent_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "email_notifications_lead_id_fkey",
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete("restrict"),
    unique("uq_email_notifications_event_lead").on(table.eventType, table.leadId),
    check("chk_email_notifications_event_type", sql`${table.eventType} = 'lead.created'`),
    check("chk_email_notifications_status", sql`${table.status} IN ('pending', 'sent', 'failed')`),
    check("chk_email_notifications_provider", sql`${table.provider} IN ('disabled', 'resend')`),
    check("chk_email_notifications_attempts", sql`${table.attempts} >= 0 AND ${table.attempts} <= 3`),
    check("chk_email_notifications_recipients", sql`cardinality(${table.recipients}) > 0`),
    index("idx_email_notifications_dispatch")
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);
