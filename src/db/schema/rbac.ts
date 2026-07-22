import { sql } from "drizzle-orm";
import {
  check,
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

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    scope: varchar("scope", {
      length: 20,
      enum: ["global", "organization", "project"],
    }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("uq_roles_scope_code").on(table.scope, table.code),
    unique("uq_roles_id_scope").on(table.id, table.scope),
    check("chk_roles_scope", sql`${table.scope} IN ('global', 'organization', 'project')`),
    check("chk_roles_code_not_blank", sql`btrim(${table.code}) <> ''`),
    check("chk_roles_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    code: varchar("code", { length: 100 }).notNull(),
    module: varchar("module", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("permissions_code_key").on(table.code),
    check("chk_permissions_code_not_blank", sql`btrim(${table.code}) <> ''`),
    check("chk_permissions_module_not_blank", sql`btrim(${table.module}) <> ''`),
    check("chk_permissions_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull(),
    permissionId: uuid("permission_id").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    foreignKey({
      name: "role_permissions_role_id_fkey",
      columns: [table.roleId],
      foreignColumns: [roles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "role_permissions_permission_id_fkey",
      columns: [table.permissionId],
      foreignColumns: [permissions.id],
    }).onDelete("cascade"),
    index("idx_role_permissions_permission_id").on(table.permissionId),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    roleScope: varchar("role_scope", { length: 20, enum: ["global"] })
      .notNull()
      .default("global"),
    assignedByUserId: uuid("assigned_by_user_id"),
    assignedAt: timestampWithTimezone("assigned_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    foreignKey({
      name: "user_roles_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "user_roles_assigned_by_user_id_fkey",
      columns: [table.assignedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_user_roles_global_role",
      columns: [table.roleId, table.roleScope],
      foreignColumns: [roles.id, roles.scope],
    }).onDelete("restrict"),
    check("chk_user_roles_global_scope", sql`${table.roleScope} = 'global'`),
    index("idx_user_roles_role_scope").on(table.roleId, table.roleScope),
    index("idx_user_roles_assigned_by").on(table.assignedByUserId),
  ],
);
