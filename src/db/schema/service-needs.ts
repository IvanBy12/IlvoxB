import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { services } from "./services.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const serviceNeeds = pgTable(
  "service_needs",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    shortDescription: varchar("short_description", { length: 500 }).notNull(),
    detailedDescription: text("detailed_description").notNull(),
    iconKey: varchar("icon_key", { length: 64 }).notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("service_needs_code_key").on(table.code),
    check("chk_service_needs_code", sql`${table.code} ~ '^[a-z][a-z0-9_]*$'`),
    check("chk_service_needs_title", sql`length(btrim(${table.title})) > 0 AND ${table.title} !~ '[<>]'`),
    check("chk_service_needs_short_description", sql`length(btrim(${table.shortDescription})) > 0 AND ${table.shortDescription} !~ '[<>]'`),
    check("chk_service_needs_detailed_description", sql`length(btrim(${table.detailedDescription})) BETWEEN 1 AND 2000 AND ${table.detailedDescription} !~ '[<>]'`),
    check("chk_service_needs_icon_key", sql`${table.iconKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("chk_service_needs_display_order", sql`${table.displayOrder} >= 0`),
    index("idx_service_needs_public_active_order").on(table.isPublic, table.isActive, table.displayOrder),
  ],
);

export const serviceNeedLinks = pgTable(
  "service_need_links",
  {
    needId: uuid("need_id").notNull().references(() => serviceNeeds.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "restrict" }),
    weight: integer("weight").notNull().default(50),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "service_need_links_pkey", columns: [table.needId, table.serviceId] }),
    check("chk_service_need_links_weight", sql`${table.weight} BETWEEN 1 AND 100`),
    index("idx_service_need_links_service").on(table.serviceId),
    index("idx_service_need_links_need_ranking").on(table.needId, table.isPrimary, table.weight),
  ],
);
