ALTER TABLE "identity_webhook_events" ADD COLUMN "clerk_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity_webhook_events" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_webhook_events" ADD COLUMN "payload_sha256" char(64);--> statement-breakpoint
ALTER TABLE "identity_webhook_events" ADD COLUMN "last_error_code" varchar(64);--> statement-breakpoint
UPDATE "identity_webhook_events"
SET "clerk_occurred_at" = "created_at",
    "payload_sha256" = encode(digest("clerk_event_id" || ':' || "event_type", 'sha256'), 'hex')
WHERE "clerk_occurred_at" IS NULL OR "payload_sha256" IS NULL;--> statement-breakpoint
ALTER TABLE "identity_webhook_events" ALTER COLUMN "clerk_occurred_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_webhook_events" ALTER COLUMN "payload_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_webhook_events" ADD CONSTRAINT "chk_identity_webhook_events_payload_sha256" CHECK ("identity_webhook_events"."payload_sha256" ~ '^[0-9A-Fa-f]{64}$');
