ALTER TABLE "deliverables" ADD COLUMN "delivery_party" varchar(20) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "chk_deliverables_delivery_party" CHECK ("deliverables"."delivery_party" IN ('internal', 'client'));--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "chk_deliverables_client_due_date" CHECK ("deliverables"."delivery_party" <> 'client' OR "deliverables"."due_date" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_deliverables_project_party_status" ON "deliverables" USING btree ("project_id", "delivery_party", "status");
