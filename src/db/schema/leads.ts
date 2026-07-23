import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";
import { services } from "./services.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    companyName: varchar("company_name", { length: 200 }),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    serviceId: uuid("service_id"),
    message: text("message").notNull(),
    source: varchar("source", {
      length: 30,
      enum: ["diagnostic", "quotation", "contact", "referral", "campaign"],
    }).notNull(),
    status: varchar("status", {
      length: 30,
      enum: [
        "new",
        "contacted",
        "in_diagnostic",
        "quotation",
        "proposal_sent",
        "negotiation",
        "approved",
        "not_approved",
        "converted",
      ],
    })
      .notNull()
      .default("new"),
    assignedToUserId: uuid("assigned_to_user_id"),
    convertedOrganizationId: uuid("converted_organization_id"),
    convertedAt: timestampWithTimezone("converted_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "leads_service_id_fkey",
      columns: [table.serviceId],
      foreignColumns: [services.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "leads_assigned_to_user_id_fkey",
      columns: [table.assignedToUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "leads_converted_organization_id_fkey",
      columns: [table.convertedOrganizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    check(
      "chk_leads_source",
      sql`${table.source} IN ('diagnostic', 'quotation', 'contact', 'referral', 'campaign')`,
    ),
    check(
      "chk_leads_status",
      sql`${table.status} IN ('new', 'contacted', 'in_diagnostic', 'quotation', 'proposal_sent', 'negotiation', 'approved', 'not_approved', 'converted')`,
    ),
    check(
      "chk_leads_conversion",
      sql`(
        (${table.status} = 'converted' AND ${table.convertedAt} IS NOT NULL)
        OR
        (${table.status} <> 'converted' AND ${table.convertedOrganizationId} IS NULL AND ${table.convertedAt} IS NULL)
      )`,
    ),
    index("idx_leads_status_created").on(table.status, table.createdAt.desc()),
    index("idx_leads_service").on(table.serviceId),
    index("idx_leads_assigned_to").on(table.assignedToUserId),
    index("idx_leads_converted_organization").on(table.convertedOrganizationId),
    index("idx_leads_email_lower").on(sql`lower(${table.email})`),
  ],
);
