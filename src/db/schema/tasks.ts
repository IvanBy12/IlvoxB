import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { tickets } from "./tickets.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    organizationId: uuid("organization_id"),
    projectId: uuid("project_id"),
    ticketId: uuid("ticket_id"),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    assignedToUserId: uuid("assigned_to_user_id").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    priority: varchar("priority", {
      length: 20,
      enum: ["low", "medium", "high", "urgent"],
    })
      .notNull()
      .default("medium"),
    status: varchar("status", {
      length: 30,
      enum: ["pending", "ready", "in_progress", "blocked", "in_review", "completed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_tasks_id_organization").on(table.id, table.organizationId),
    foreignKey({
      name: "tasks_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_assigned_to_user_id_fkey",
      columns: [table.assignedToUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_created_by_user_id_fkey",
      columns: [table.createdByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_tasks_project",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_tasks_ticket",
      columns: [table.ticketId, table.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }).onDelete("restrict"),
    check(
      "chk_tasks_priority",
      sql`${table.priority} IN ('low', 'medium', 'high', 'urgent')`,
    ),
    check(
      "chk_tasks_status",
      sql`${table.status} IN ('pending', 'ready', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled')`,
    ),
    check(
      "chk_tasks_estimated_minutes",
      sql`${table.estimatedMinutes} IS NULL OR ${table.estimatedMinutes} >= 0`,
    ),
    check(
      "chk_tasks_single_context",
      sql`num_nonnulls(${table.projectId}, ${table.ticketId}) <= 1`,
    ),
    check(
      "chk_tasks_context_organization",
      sql`(
        (${table.projectId} IS NULL AND ${table.ticketId} IS NULL AND ${table.organizationId} IS NULL)
        OR
        (num_nonnulls(${table.projectId}, ${table.ticketId}) = 1 AND ${table.organizationId} IS NOT NULL)
      )`,
    ),
    index("idx_tasks_organization_status").on(table.organizationId, table.status),
    index("idx_tasks_project").on(table.projectId),
    index("idx_tasks_ticket").on(table.ticketId),
    index("idx_tasks_assignee_status").on(table.assignedToUserId, table.status),
    index("idx_tasks_due_date").on(table.dueDate),
  ],
);
