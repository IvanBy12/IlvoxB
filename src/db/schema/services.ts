import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const services = pgTable(
  "services",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    category: varchar("category", {
      length: 40,
      enum: ["development", "ecommerce", "digital_presence", "automation", "support"],
    }).notNull(),
    description: text("description").notNull(),
    isPublic: boolean("is_public").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("services_name_key").on(table.name),
    check(
      "chk_services_category",
      sql`${table.category} IN ('development', 'ecommerce', 'digital_presence', 'automation', 'support')`,
    ),
    index("idx_services_public_active").on(table.isPublic, table.isActive),
  ],
);
