import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";
import { roles } from "./rbac.js";
import { services } from "./services.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id"),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull(),
    status: varchar("status", {
      length: 30,
      enum: ["planning", "in_progress", "paused", "in_review", "delivered", "cancelled"],
    })
      .notNull()
      .default("planning"),
    priority: varchar("priority", {
      length: 20,
      enum: ["low", "medium", "high", "urgent"],
    })
      .notNull()
      .default("medium"),
    leadUserId: uuid("lead_user_id").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_projects_id_organization").on(table.id, table.organizationId),
    foreignKey({
      name: "projects_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "projects_service_id_fkey",
      columns: [table.serviceId],
      foreignColumns: [services.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "projects_lead_user_id_fkey",
      columns: [table.leadUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "projects_created_by_user_id_fkey",
      columns: [table.createdByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    check(
      "chk_projects_status",
      sql`${table.status} IN ('planning', 'in_progress', 'paused', 'in_review', 'delivered', 'cancelled')`,
    ),
    check(
      "chk_projects_priority",
      sql`${table.priority} IN ('low', 'medium', 'high', 'urgent')`,
    ),
    check("chk_projects_dates", sql`${table.dueDate} >= ${table.startDate}`),
    index("idx_projects_organization_status").on(table.organizationId, table.status),
    index("idx_projects_service").on(table.serviceId),
    index("idx_projects_lead").on(table.leadUserId),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    roleScope: varchar("role_scope", { length: 20, enum: ["project"] })
      .notNull()
      .default("project"),
    assignedByUserId: uuid("assigned_by_user_id"),
    status: varchar("status", { length: 20, enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    revokedAt: timestampWithTimezone("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id"),
    joinedAt: timestampWithTimezone("joined_at").notNull().defaultNow(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    foreignKey({
      name: "project_members_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "project_members_assigned_by_user_id_fkey",
      columns: [table.assignedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict").onUpdate("no action"),
    foreignKey({
      name: "project_members_revoked_by_user_id_fkey",
      columns: [table.revokedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict").onUpdate("no action"),
    foreignKey({
      name: "fk_project_members_project",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_project_members_project_role",
      columns: [table.roleId, table.roleScope],
      foreignColumns: [roles.id, roles.scope],
    }).onDelete("restrict"),
    check("chk_project_members_scope", sql`${table.roleScope} = 'project'`),
    check(
      "chk_project_members_status",
      sql`${table.status} IN ('active', 'revoked')`,
    ),
    check(
      "chk_project_members_revocation",
      sql`(
        (${table.status} = 'active' AND ${table.revokedAt} IS NULL AND ${table.revokedByUserId} IS NULL)
        OR
        (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL AND ${table.revokedByUserId} IS NOT NULL)
      )`,
    ),
    index("idx_project_members_user").on(table.userId),
    index("idx_project_members_active_user")
      .on(table.userId, table.projectId)
      .where(sql`${table.status} = 'active'`),
    index("idx_project_members_role_scope").on(table.roleId, table.roleScope),
    index("idx_project_members_assigned_by").on(table.assignedByUserId),
  ],
);

export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    projectId: uuid("project_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "in_progress", "completed"],
    })
      .notNull()
      .default("pending"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    completedAt: timestampWithTimezone("completed_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_project_milestones_id_organization").on(table.id, table.organizationId),
    unique("uq_project_milestones_id_project_organization").on(
      table.id,
      table.projectId,
      table.organizationId,
    ),
    foreignKey({
      name: "fk_project_milestones_project",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    check(
      "chk_project_milestones_status",
      sql`${table.status} IN ('pending', 'in_progress', 'completed')`,
    ),
    check(
      "chk_project_milestones_completed_at",
      sql`(
        (${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL)
        OR
        (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)
      )`,
    ),
    index("idx_project_milestones_project_status").on(table.projectId, table.status),
    index("idx_project_milestones_due_date").on(table.dueDate),
  ],
);

export const deliverables = pgTable(
  "deliverables",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    projectId: uuid("project_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    milestoneId: uuid("milestone_id"),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "in_review", "delivered", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    approvedByUserId: uuid("approved_by_user_id"),
    approvedAt: timestampWithTimezone("approved_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_deliverables_id_organization").on(table.id, table.organizationId),
    foreignKey({
      name: "deliverables_approved_by_user_id_fkey",
      columns: [table.approvedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_deliverables_project",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_deliverables_milestone_project",
      columns: [table.milestoneId, table.projectId, table.organizationId],
      foreignColumns: [
        projectMilestones.id,
        projectMilestones.projectId,
        projectMilestones.organizationId,
      ],
    }).onDelete("restrict").onUpdate("no action"),
    check(
      "chk_deliverables_status",
      sql`${table.status} IN ('pending', 'in_review', 'delivered', 'approved', 'rejected')`,
    ),
    check(
      "chk_deliverables_approval",
      sql`(
        (${table.status} = 'approved' AND ${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)
        OR
        (${table.status} <> 'approved' AND ${table.approvedByUserId} IS NULL AND ${table.approvedAt} IS NULL)
      )`,
    ),
    index("idx_deliverables_project_status").on(table.projectId, table.status),
    index("idx_deliverables_milestone").on(table.milestoneId),
    index("idx_deliverables_approved_by").on(table.approvedByUserId),
  ],
);
