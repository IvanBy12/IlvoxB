import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";
import { roles } from "./rbac.js";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    normalizedEmail: varchar("normalized_email", { length: 320 }).notNull(),
    membershipRole: varchar("membership_role", {
      length: 40,
      enum: ["client_manager", "client_contact"],
    }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "accepted", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    clerkInvitationId: varchar("clerk_invitation_id", { length: 255 }),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    acceptedByUserId: uuid("accepted_by_user_id"),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    acceptedAt: timestampWithTimezone("accepted_at"),
    revokedAt: timestampWithTimezone("revoked_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "organization_invitations_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "organization_invitations_invited_by_user_id_fkey",
      columns: [table.invitedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "organization_invitations_accepted_by_user_id_fkey",
      columns: [table.acceptedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    check(
      "chk_organization_invitations_email_not_blank",
      sql`btrim(${table.email}) <> '' AND btrim(${table.normalizedEmail}) <> ''`,
    ),
    check(
      "chk_organization_invitations_email_normalized",
      sql`${table.normalizedEmail} = lower(btrim(${table.email}))`,
    ),
    check(
      "chk_organization_invitations_membership_role",
      sql`${table.membershipRole} IN ('client_manager', 'client_contact')`,
    ),
    check(
      "chk_organization_invitations_status",
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`,
    ),
    check(
      "chk_organization_invitations_lifecycle",
      sql`(
        (${table.status} IN ('pending', 'expired') AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL)
        OR
        (${table.status} = 'accepted' AND ${table.acceptedByUserId} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
        OR
        (${table.status} = 'revoked' AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NOT NULL)
      )`,
    ),
    check(
      "chk_organization_invitations_expiration",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    uniqueIndex("uq_organization_invitations_pending_email")
      .on(table.organizationId, table.normalizedEmail)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("uq_organization_invitations_clerk_id")
      .on(table.clerkInvitationId)
      .where(sql`${table.clerkInvitationId} IS NOT NULL`),
    index("idx_organization_invitations_organization").on(table.organizationId),
    index("idx_organization_invitations_email").on(table.normalizedEmail),
    index("idx_organization_invitations_status").on(table.status),
  ],
);

export const internalUserInvitations = pgTable(
  "internal_user_invitations",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    normalizedEmail: varchar("normalized_email", { length: 320 }).notNull(),
    roleId: uuid("role_id").notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "accepted", "revoked", "expired"],
    }).notNull().default("pending"),
    clerkInvitationId: varchar("clerk_invitation_id", { length: 255 }),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    acceptedByUserId: uuid("accepted_by_user_id"),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    acceptedAt: timestampWithTimezone("accepted_at"),
    revokedAt: timestampWithTimezone("revoked_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "internal_user_invitations_role_id_fkey",
      columns: [table.roleId],
      foreignColumns: [roles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_user_invitations_invited_by_user_id_fkey",
      columns: [table.invitedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "internal_user_invitations_accepted_by_user_id_fkey",
      columns: [table.acceptedByUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    check(
      "chk_internal_user_invitations_email_not_blank",
      sql`btrim(${table.email}) <> '' AND btrim(${table.normalizedEmail}) <> ''`,
    ),
    check(
      "chk_internal_user_invitations_email_normalized",
      sql`${table.normalizedEmail} = lower(btrim(${table.email}))`,
    ),
    check(
      "chk_internal_user_invitations_status",
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`,
    ),
    check(
      "chk_internal_user_invitations_lifecycle",
      sql`(
        (${table.status} IN ('pending', 'expired') AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL)
        OR
        (${table.status} = 'accepted' AND ${table.acceptedByUserId} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
        OR
        (${table.status} = 'revoked' AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NOT NULL)
      )`,
    ),
    check(
      "chk_internal_user_invitations_expiration",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    uniqueIndex("uq_internal_user_invitations_pending_email")
      .on(table.normalizedEmail)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("uq_internal_user_invitations_clerk_id")
      .on(table.clerkInvitationId)
      .where(sql`${table.clerkInvitationId} IS NOT NULL`),
    index("idx_internal_user_invitations_email").on(table.normalizedEmail),
    index("idx_internal_user_invitations_status").on(table.status),
  ],
);
