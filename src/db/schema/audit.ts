import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { appUsers } from "./identity.js";
import { organizations } from "./organizations.js";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    actorUserId: uuid("actor_user_id"),
    organizationId: uuid("organization_id"),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "audit_events_actor_user_id_fkey",
      columns: [table.actorUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_events_organization_id_fkey",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    check(
      "chk_audit_events_old_values_object",
      sql`${table.oldValues} IS NULL OR jsonb_typeof(${table.oldValues}) = 'object'`,
    ),
    check(
      "chk_audit_events_new_values_object",
      sql`${table.newValues} IS NULL OR jsonb_typeof(${table.newValues}) = 'object'`,
    ),
    index("idx_audit_events_actor_created").on(table.actorUserId, table.createdAt.desc()),
    index("idx_audit_events_organization_created").on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    index("idx_audit_events_entity").on(table.entityType, table.entityId, table.createdAt.desc()),
    index("idx_audit_events_request")
      .on(table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
    index("idx_audit_events_created").on(table.createdAt.desc()),
  ],
);
