import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";
import { deliverables, projects } from "./projects.js";
import { tasks } from "./tasks.js";
import { ticketComments, tickets } from "./tickets.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const files = pgTable(
  "files",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id"),
    ticketId: uuid("ticket_id"),
    ticketCommentId: uuid("ticket_comment_id"),
    taskId: uuid("task_id"),
    deliverableId: uuid("deliverable_id"),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    storageProvider: varchar("storage_provider", { length: 40 }).notNull(),
    objectKey: varchar("object_key", { length: 1024 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    checksumSha256: char("checksum_sha256", { length: 64 }),
    classification: varchar("classification", {
      length: 20,
      enum: ["internal", "confidential"],
    })
      .notNull()
      .default("confidential"),
    audience: varchar("audience", {
      length: 20,
      enum: ["internal", "organization"],
    })
      .notNull()
      .default("internal"),
    status: varchar("status", {
      length: 20,
      enum: ["pending_upload", "pending_scan", "active", "quarantined", "deleted"],
    })
      .notNull()
      .default("pending_scan"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    deletedAt: timestampWithTimezone("deleted_at"),
  },
  (table) => [
    unique("uq_files_provider_object_key").on(table.storageProvider, table.objectKey),
    foreignKey({
      name: "files_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "files_uploaded_by_user_id_fkey",
      columns: [table.uploadedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_files_project",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_files_ticket",
      columns: [table.ticketId, table.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_files_ticket_comment",
      columns: [table.ticketCommentId, table.organizationId],
      foreignColumns: [ticketComments.id, ticketComments.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_files_task",
      columns: [table.taskId, table.organizationId],
      foreignColumns: [tasks.id, tasks.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_files_deliverable",
      columns: [table.deliverableId, table.organizationId],
      foreignColumns: [deliverables.id, deliverables.organizationId],
    }).onDelete("restrict"),
    check("chk_files_object_key_not_blank", sql`btrim(${table.objectKey}) <> ''`),
    check("chk_files_size_bytes", sql`${table.sizeBytes} > 0`),
    check(
      "chk_files_checksum_sha256",
      sql`${table.checksumSha256} IS NULL OR ${table.checksumSha256} ~ '^[0-9A-Fa-f]{64}$'`,
    ),
    check(
      "chk_files_classification",
      sql`${table.classification} IN ('internal', 'confidential')`,
    ),
    check(
      "chk_files_audience",
      sql`${table.audience} IN ('internal', 'organization')`,
    ),
    check(
      "chk_files_status",
      sql`${table.status} IN ('pending_upload', 'pending_scan', 'active', 'quarantined', 'deleted')`,
    ),
    check(
      "chk_files_single_parent",
      sql`num_nonnulls(${table.projectId}, ${table.ticketId}, ${table.ticketCommentId}, ${table.taskId}, ${table.deliverableId}) <= 1`,
    ),
    index("idx_files_organization_active")
      .on(table.organizationId, table.createdAt.desc())
      .where(sql`${table.status} = 'active' AND ${table.deletedAt} IS NULL`),
    index("idx_files_organization_audience_active")
      .on(table.organizationId, table.audience, table.createdAt.desc())
      .where(sql`${table.status} = 'active' AND ${table.deletedAt} IS NULL`),
    index("idx_files_project").on(table.projectId).where(sql`${table.projectId} IS NOT NULL`),
    index("idx_files_ticket").on(table.ticketId).where(sql`${table.ticketId} IS NOT NULL`),
    index("idx_files_ticket_comment")
      .on(table.ticketCommentId)
      .where(sql`${table.ticketCommentId} IS NOT NULL`),
    index("idx_files_task").on(table.taskId).where(sql`${table.taskId} IS NOT NULL`),
    index("idx_files_deliverable")
      .on(table.deliverableId)
      .where(sql`${table.deliverableId} IS NOT NULL`),
    index("idx_files_uploaded_by").on(table.uploadedByUserId),
  ],
);
