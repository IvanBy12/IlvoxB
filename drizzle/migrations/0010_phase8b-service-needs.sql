CREATE TABLE "service_need_links" (
	"need_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"weight" integer DEFAULT 50 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_need_links_pkey" PRIMARY KEY("need_id","service_id"),
	CONSTRAINT "chk_service_need_links_weight" CHECK ("service_need_links"."weight" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "service_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"title" varchar(160) NOT NULL,
	"short_description" varchar(500) NOT NULL,
	"detailed_description" text NOT NULL,
	"icon_key" varchar(64) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_needs_code_key" UNIQUE("code"),
	CONSTRAINT "chk_service_needs_code" CHECK ("service_needs"."code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "chk_service_needs_title" CHECK (length(btrim("service_needs"."title")) > 0 AND "service_needs"."title" !~ '[<>]'),
	CONSTRAINT "chk_service_needs_short_description" CHECK (length(btrim("service_needs"."short_description")) > 0 AND "service_needs"."short_description" !~ '[<>]'),
	CONSTRAINT "chk_service_needs_detailed_description" CHECK (length(btrim("service_needs"."detailed_description")) BETWEEN 1 AND 2000 AND "service_needs"."detailed_description" !~ '[<>]'),
	CONSTRAINT "chk_service_needs_icon_key" CHECK ("service_needs"."icon_key" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "chk_service_needs_display_order" CHECK ("service_needs"."display_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_need_links" ADD CONSTRAINT "service_need_links_need_id_service_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."service_needs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_need_links" ADD CONSTRAINT "service_need_links_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_service_need_links_service" ON "service_need_links" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_service_need_links_need_ranking" ON "service_need_links" USING btree ("need_id","is_primary","weight");--> statement-breakpoint
CREATE INDEX "idx_service_needs_public_active_order" ON "service_needs" USING btree ("is_public","is_active","display_order");
