import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { leads } from "./leads.js";
import { serviceNeeds } from "./service-needs.js";

const timestampWithTimezone = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const diagnosticRuleSets = pgTable(
  "diagnostic_rule_sets",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    version: integer("version").notNull(),
    status: varchar("status", { length: 16, enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    publishedAt: timestampWithTimezone("published_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("diagnostic_rule_sets_version_key").on(table.version),
    uniqueIndex("diagnostic_rule_sets_one_published_idx").on(table.status).where(sql`${table.status} = 'published'`),
    check("chk_diagnostic_rule_sets_version", sql`${table.version} > 0`),
    check("chk_diagnostic_rule_sets_status", sql`${table.status} IN ('draft', 'published', 'archived')`),
    check("chk_diagnostic_rule_sets_title", sql`length(btrim(${table.title})) > 0 AND ${table.title} !~ '[<>]'`),
    check("chk_diagnostic_rule_sets_description", sql`length(btrim(${table.description})) BETWEEN 1 AND 2000 AND ${table.description} !~ '[<>]'`),
  ],
);

export const diagnosticQuestions = pgTable(
  "diagnostic_questions",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    ruleSetId: uuid("rule_set_id").notNull().references(() => diagnosticRuleSets.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 64 }).notNull(),
    question: varchar("question", { length: 500 }).notNull(),
    helpText: varchar("help_text", { length: 1000 }),
    type: varchar("type", { length: 24, enum: ["single_choice", "multiple_choice"] }).notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    required: boolean("required").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    unique("diagnostic_questions_rule_set_code_key").on(table.ruleSetId, table.code),
    check("chk_diagnostic_questions_code", sql`${table.code} ~ '^[a-z][a-z0-9_]*$'`),
    check("chk_diagnostic_questions_question", sql`length(btrim(${table.question})) > 0 AND ${table.question} !~ '[<>]'`),
    check("chk_diagnostic_questions_type", sql`${table.type} IN ('single_choice', 'multiple_choice')`),
    check("chk_diagnostic_questions_display_order", sql`${table.displayOrder} >= 0`),
    index("idx_diagnostic_questions_ruleset_order").on(table.ruleSetId, table.isActive, table.displayOrder),
  ],
);

export const diagnosticOptions = pgTable(
  "diagnostic_options",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    questionId: uuid("question_id").notNull().references(() => diagnosticQuestions.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 64 }).notNull(),
    label: varchar("label", { length: 300 }).notNull(),
    description: varchar("description", { length: 1000 }),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (table) => [
    unique("diagnostic_options_question_code_key").on(table.questionId, table.code),
    check("chk_diagnostic_options_code", sql`${table.code} ~ '^[a-z][a-z0-9_]*$'`),
    check("chk_diagnostic_options_label", sql`length(btrim(${table.label})) > 0 AND ${table.label} !~ '[<>]'`),
    check("chk_diagnostic_options_display_order", sql`${table.displayOrder} >= 0`),
    index("idx_diagnostic_options_question_order").on(table.questionId, table.displayOrder),
  ],
);

export const diagnosticOptionNeedPoints = pgTable(
  "diagnostic_option_need_points",
  {
    optionId: uuid("option_id").notNull().references(() => diagnosticOptions.id, { onDelete: "restrict" }),
    needId: uuid("need_id").notNull().references(() => serviceNeeds.id, { onDelete: "restrict" }),
    points: integer("points").notNull(),
  },
  (table) => [
    unique("diagnostic_option_need_points_option_need_key").on(table.optionId, table.needId),
    check("chk_diagnostic_option_need_points_positive", sql`${table.points} > 0`),
    index("idx_diagnostic_option_need_points_need").on(table.needId),
  ],
);

export const diagnosticRuns = pgTable(
  "diagnostic_runs",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    ruleSetId: uuid("rule_set_id").notNull().references(() => diagnosticRuleSets.id, { onDelete: "restrict" }),
    initialNeedId: uuid("initial_need_id").references(() => serviceNeeds.id, { onDelete: "restrict" }),
    answers: jsonb("answers").notNull(),
    needScores: jsonb("need_scores").notNull(),
    resultSnapshot: jsonb("result_snapshot").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "restrict" }),
    completedAt: timestampWithTimezone("completed_at").notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("diagnostic_runs_lead_id_key").on(table.leadId),
    check("chk_diagnostic_runs_expiry", sql`${table.expiresAt} > ${table.completedAt}`),
    index("idx_diagnostic_runs_ruleset").on(table.ruleSetId),
    index("idx_diagnostic_runs_unclaimed_expiry").on(table.expiresAt, table.leadId),
  ],
);
