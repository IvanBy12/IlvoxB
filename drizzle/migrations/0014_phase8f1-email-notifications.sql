CREATE TABLE "email_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"recipients" text[] NOT NULL,
	"subject" varchar(300) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" varchar(30) NOT NULL,
	"provider_message_id" varchar(200),
	"last_error" varchar(160),
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_email_notifications_event_lead" UNIQUE("event_type","lead_id"),
	CONSTRAINT "chk_email_notifications_event_type" CHECK ("email_notifications"."event_type" = 'lead.created'),
	CONSTRAINT "chk_email_notifications_status" CHECK ("email_notifications"."status" IN ('pending', 'sent', 'failed')),
	CONSTRAINT "chk_email_notifications_provider" CHECK ("email_notifications"."provider" IN ('disabled', 'resend')),
	CONSTRAINT "chk_email_notifications_attempts" CHECK ("email_notifications"."attempts" >= 0 AND "email_notifications"."attempts" <= 3),
	CONSTRAINT "chk_email_notifications_recipients" CHECK (cardinality("email_notifications"."recipients") > 0)
);
--> statement-breakpoint
ALTER TABLE "email_notifications" ADD CONSTRAINT "email_notifications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_notifications_dispatch" ON "email_notifications" USING btree ("next_attempt_at","created_at") WHERE "email_notifications"."status" = 'pending';