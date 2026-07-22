import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id"),
    requesterUserId: uuid("requester_user_id").notNull(),
    assignedToUserId: uuid("assigned_to_user_id"),
    ticketNumber: bigint("ticket_number", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    ticketYear: smallint("ticket_year")
      .notNull()
      .default(sql`(EXTRACT(YEAR FROM CURRENT_DATE)::smallint)`),
    code: varchar("code", { length: 40 }).generatedAlwaysAs(
      sql`'TCK-' || ticket_year::text || '-' || repeat('0', greatest(6 - length(ticket_number::text), 0)) || ticket_number::text`,
    ),
    type: varchar("type", {
      length: 30,
      enum: ["incident", "bug", "service_request", "improvement_request", "question", "change"],
    }).notNull(),
    requestedPriority: varchar("requested_priority", {
      length: 20,
      enum: ["low", "medium", "high", "urgent"],
    })
      .notNull()
      .default("medium"),
    priority: varchar("priority", {
      length: 20,
      enum: ["low", "medium", "high", "urgent"],
    })
      .notNull()
      .default("medium"),
    status: varchar("status", {
      length: 30,
      enum: [
        "new",
        "classifying",
        "assigned",
        "in_progress",
        "pending_client",
        "resolved",
        "closed",
        "reopened",
        "cancelled",
      ],
    })
      .notNull()
      .default("new"),
    subject: varchar("subject", { length: 240 }).notNull(),
    description: text("description").notNull(),
    resolution: text("resolution"),
    resolvedAt: timestampWithTimezone("resolved_at"),
    closedAt: timestampWithTimezone("closed_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_tickets_ticket_number").on(table.ticketNumber),
    unique("uq_tickets_code").on(table.code),
    unique("uq_tickets_id_organization").on(table.id, table.organizationId),
    foreignKey({
      name: "tickets_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tickets_requester_user_id_fkey",
      columns: [table.requesterUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tickets_assigned_to_user_id_fkey",
      columns: [table.assignedToUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_tickets_project",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    check("chk_tickets_ticket_year", sql`${table.ticketYear} BETWEEN 2000 AND 9999`),
    check(
      "chk_tickets_type",
      sql`${table.type} IN ('incident', 'bug', 'service_request', 'improvement_request', 'question', 'change')`,
    ),
    check(
      "chk_tickets_requested_priority",
      sql`${table.requestedPriority} IN ('low', 'medium', 'high', 'urgent')`,
    ),
    check(
      "chk_tickets_priority",
      sql`${table.priority} IN ('low', 'medium', 'high', 'urgent')`,
    ),
    check(
      "chk_tickets_status",
      sql`${table.status} IN ('new', 'classifying', 'assigned', 'in_progress', 'pending_client', 'resolved', 'closed', 'reopened', 'cancelled')`,
    ),
    check(
      "chk_tickets_resolution",
      sql`(
        ${table.status} NOT IN ('resolved', 'closed')
        OR
        (${table.resolution} IS NOT NULL AND btrim(${table.resolution}) <> '' AND ${table.resolvedAt} IS NOT NULL)
      )`,
    ),
    check(
      "chk_tickets_closed_at",
      sql`(
        (${table.status} = 'closed' AND ${table.closedAt} IS NOT NULL)
        OR
        (${table.status} <> 'closed' AND ${table.closedAt} IS NULL)
      )`,
    ),
    index("idx_tickets_organization_status").on(table.organizationId, table.status),
    index("idx_tickets_project").on(table.projectId),
    index("idx_tickets_requester").on(table.requesterUserId),
    index("idx_tickets_assignee_status").on(table.assignedToUserId, table.status),
    index("idx_tickets_created_at").on(table.createdAt.desc()),
  ],
);

export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    ticketId: uuid("ticket_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    authorUserId: uuid("author_user_id").notNull(),
    visibility: varchar("visibility", { length: 20, enum: ["internal", "client"] }).notNull(),
    content: text("content").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_ticket_comments_id_organization").on(table.id, table.organizationId),
    foreignKey({
      name: "ticket_comments_author_user_id_fkey",
      columns: [table.authorUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_ticket_comments_ticket",
      columns: [table.ticketId, table.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }).onDelete("restrict"),
    check(
      "chk_ticket_comments_visibility",
      sql`${table.visibility} IN ('internal', 'client')`,
    ),
    check("chk_ticket_comments_content", sql`btrim(${table.content}) <> ''`),
    index("idx_ticket_comments_ticket_created").on(table.ticketId, table.createdAt),
    index("idx_ticket_comments_author").on(table.authorUserId),
    index("idx_ticket_comments_client_visible")
      .on(table.ticketId, table.createdAt)
      .where(sql`${table.visibility} = 'client'`),
  ],
);
