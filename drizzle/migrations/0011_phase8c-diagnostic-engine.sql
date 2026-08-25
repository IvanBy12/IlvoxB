CREATE TABLE "diagnostic_option_need_points" (
	"option_id" uuid NOT NULL,
	"need_id" uuid NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "diagnostic_option_need_points_option_need_key" UNIQUE("option_id","need_id"),
	CONSTRAINT "chk_diagnostic_option_need_points_positive" CHECK ("diagnostic_option_need_points"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "diagnostic_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"label" varchar(300) NOT NULL,
	"description" varchar(1000),
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "diagnostic_options_question_code_key" UNIQUE("question_id","code"),
	CONSTRAINT "chk_diagnostic_options_code" CHECK ("diagnostic_options"."code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "chk_diagnostic_options_label" CHECK (length(btrim("diagnostic_options"."label")) > 0 AND "diagnostic_options"."label" !~ '[<>]'),
	CONSTRAINT "chk_diagnostic_options_display_order" CHECK ("diagnostic_options"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "diagnostic_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"question" varchar(500) NOT NULL,
	"help_text" varchar(1000),
	"type" varchar(24) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "diagnostic_questions_rule_set_code_key" UNIQUE("rule_set_id","code"),
	CONSTRAINT "chk_diagnostic_questions_code" CHECK ("diagnostic_questions"."code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "chk_diagnostic_questions_question" CHECK (length(btrim("diagnostic_questions"."question")) > 0 AND "diagnostic_questions"."question" !~ '[<>]'),
	CONSTRAINT "chk_diagnostic_questions_type" CHECK ("diagnostic_questions"."type" IN ('single_choice', 'multiple_choice')),
	CONSTRAINT "chk_diagnostic_questions_display_order" CHECK ("diagnostic_questions"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "diagnostic_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_rule_sets_version_key" UNIQUE("version"),
	CONSTRAINT "chk_diagnostic_rule_sets_version" CHECK ("diagnostic_rule_sets"."version" > 0),
	CONSTRAINT "chk_diagnostic_rule_sets_status" CHECK ("diagnostic_rule_sets"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "chk_diagnostic_rule_sets_title" CHECK (length(btrim("diagnostic_rule_sets"."title")) > 0 AND "diagnostic_rule_sets"."title" !~ '[<>]'),
	CONSTRAINT "chk_diagnostic_rule_sets_description" CHECK (length(btrim("diagnostic_rule_sets"."description")) BETWEEN 1 AND 2000 AND "diagnostic_rule_sets"."description" !~ '[<>]')
);
--> statement-breakpoint
CREATE TABLE "diagnostic_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"initial_need_id" uuid,
	"answers" jsonb NOT NULL,
	"need_scores" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"lead_id" uuid,
	"completed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_runs_lead_id_key" UNIQUE("lead_id"),
	CONSTRAINT "chk_diagnostic_runs_expiry" CHECK ("diagnostic_runs"."expires_at" > "diagnostic_runs"."completed_at")
);
--> statement-breakpoint
ALTER TABLE "diagnostic_option_need_points" ADD CONSTRAINT "diagnostic_option_need_points_option_id_diagnostic_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."diagnostic_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_option_need_points" ADD CONSTRAINT "diagnostic_option_need_points_need_id_service_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."service_needs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_options" ADD CONSTRAINT "diagnostic_options_question_id_diagnostic_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."diagnostic_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_questions" ADD CONSTRAINT "diagnostic_questions_rule_set_id_diagnostic_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."diagnostic_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_rule_set_id_diagnostic_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."diagnostic_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_initial_need_id_service_needs_id_fk" FOREIGN KEY ("initial_need_id") REFERENCES "public"."service_needs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_diagnostic_option_need_points_need" ON "diagnostic_option_need_points" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "idx_diagnostic_options_question_order" ON "diagnostic_options" USING btree ("question_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_diagnostic_questions_ruleset_order" ON "diagnostic_questions" USING btree ("rule_set_id","is_active","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_rule_sets_one_published_idx" ON "diagnostic_rule_sets" USING btree ("status") WHERE "diagnostic_rule_sets"."status" = 'published';--> statement-breakpoint
CREATE INDEX "idx_diagnostic_runs_ruleset" ON "diagnostic_runs" USING btree ("rule_set_id");--> statement-breakpoint
CREATE INDEX "idx_diagnostic_runs_unclaimed_expiry" ON "diagnostic_runs" USING btree ("expires_at","lead_id");