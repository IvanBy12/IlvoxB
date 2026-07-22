ALTER TABLE "files" DROP CONSTRAINT "chk_files_single_parent";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "audience" varchar(20) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_files_organization_audience_active" ON "files" USING btree ("organization_id","audience","created_at" DESC NULLS LAST) WHERE "files"."status" = 'active' AND "files"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "chk_files_audience" CHECK ("files"."audience" IN ('internal', 'organization'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "chk_files_single_parent" CHECK (num_nonnulls("files"."project_id", "files"."ticket_id", "files"."ticket_comment_id", "files"."task_id", "files"."deliverable_id") <= 1);