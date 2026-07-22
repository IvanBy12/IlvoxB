import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { roles } from "./rbac.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legal_name", { length: 200 }),
    industry: varchar("industry", { length: 120 }),
    size: varchar("size", {
      length: 20,
      enum: ["micro", "small", "medium", "large"],
    }),
    status: varchar("status", {
      length: 20,
      enum: ["active", "inactive", "archived"],
    })
      .notNull()
      .default("active"),
    countryCode: char("country_code", { length: 2 }),
    taxId: varchar("tax_id", { length: 64 }),
    taxIdNormalized: varchar("tax_id_normalized", { length: 64 }),
    accountManagerUserId: uuid("account_manager_user_id"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "organizations_account_manager_user_id_fkey",
      columns: [table.accountManagerUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    check("chk_organizations_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "chk_organizations_size",
      sql`${table.size} IS NULL OR ${table.size} IN ('micro', 'small', 'medium', 'large')`,
    ),
    check(
      "chk_organizations_status",
      sql`${table.status} IN ('active', 'inactive', 'archived')`,
    ),
    check(
      "chk_organizations_country_code",
      sql`${table.countryCode} IS NULL OR ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "chk_organizations_tax_fields",
      sql`(
        (${table.taxId} IS NULL AND ${table.taxIdNormalized} IS NULL)
        OR
        (
          ${table.taxId} IS NOT NULL
          AND ${table.taxIdNormalized} IS NOT NULL
          AND ${table.countryCode} IS NOT NULL
          AND btrim(${table.taxIdNormalized}) <> ''
        )
      )`,
    ),
    uniqueIndex("uq_organizations_country_tax_normalized")
      .on(table.countryCode, table.taxIdNormalized)
      .where(sql`${table.countryCode} IS NOT NULL AND ${table.taxIdNormalized} IS NOT NULL`),
    index("idx_organizations_account_manager").on(table.accountManagerUserId),
    index("idx_organizations_status").on(table.status),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    roleScope: varchar("role_scope", { length: 20, enum: ["organization"] })
      .notNull()
      .default("organization"),
    status: varchar("status", { length: 20, enum: ["pending", "active", "revoked"] })
      .notNull()
      .default("pending"),
    jobTitle: varchar("job_title", { length: 120 }),
    phone: varchar("phone", { length: 40 }),
    activatedAt: timestampWithTimezone("activated_at"),
    revokedAt: timestampWithTimezone("revoked_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    foreignKey({
      name: "organization_memberships_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "organization_memberships_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_organization_memberships_organization_role",
      columns: [table.roleId, table.roleScope],
      foreignColumns: [roles.id, roles.scope],
    }).onDelete("restrict"),
    check("chk_organization_memberships_scope", sql`${table.roleScope} = 'organization'`),
    check(
      "chk_organization_memberships_status",
      sql`${table.status} IN ('pending', 'active', 'revoked')`,
    ),
    check(
      "chk_organization_memberships_timestamps",
      sql`(
        (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
        OR
        (${table.status} = 'pending' AND ${table.activatedAt} IS NULL AND ${table.revokedAt} IS NULL)
        OR
        (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)
      )`,
    ),
    index("idx_organization_memberships_user").on(table.userId),
    index("idx_organization_memberships_role_scope").on(table.roleId, table.roleScope),
    index("idx_organization_memberships_access").on(table.organizationId, table.status),
  ],
);
