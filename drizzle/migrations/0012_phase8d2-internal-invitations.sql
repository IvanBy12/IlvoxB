CREATE TABLE "internal_user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"role_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"clerk_invitation_id" varchar(255),
	"invited_by_user_id" uuid NOT NULL,
	"accepted_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_internal_user_invitations_email_not_blank" CHECK (btrim("internal_user_invitations"."email") <> '' AND btrim("internal_user_invitations"."normalized_email") <> ''),
	CONSTRAINT "chk_internal_user_invitations_email_normalized" CHECK ("internal_user_invitations"."normalized_email" = lower(btrim("internal_user_invitations"."email"))),
	CONSTRAINT "chk_internal_user_invitations_status" CHECK ("internal_user_invitations"."status" IN ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "chk_internal_user_invitations_lifecycle" CHECK ((
        ("internal_user_invitations"."status" IN ('pending', 'expired') AND "internal_user_invitations"."accepted_by_user_id" IS NULL AND "internal_user_invitations"."accepted_at" IS NULL AND "internal_user_invitations"."revoked_at" IS NULL)
        OR
        ("internal_user_invitations"."status" = 'accepted' AND "internal_user_invitations"."accepted_by_user_id" IS NOT NULL AND "internal_user_invitations"."accepted_at" IS NOT NULL AND "internal_user_invitations"."revoked_at" IS NULL)
        OR
        ("internal_user_invitations"."status" = 'revoked' AND "internal_user_invitations"."accepted_by_user_id" IS NULL AND "internal_user_invitations"."accepted_at" IS NULL AND "internal_user_invitations"."revoked_at" IS NOT NULL)
      )),
	CONSTRAINT "chk_internal_user_invitations_expiration" CHECK ("internal_user_invitations"."expires_at" > "internal_user_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "internal_user_invitations" ADD CONSTRAINT "internal_user_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_user_invitations" ADD CONSTRAINT "internal_user_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_user_invitations" ADD CONSTRAINT "internal_user_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_internal_user_invitations_pending_email" ON "internal_user_invitations" USING btree ("normalized_email") WHERE "internal_user_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_internal_user_invitations_clerk_id" ON "internal_user_invitations" USING btree ("clerk_invitation_id") WHERE "internal_user_invitations"."clerk_invitation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_internal_user_invitations_email" ON "internal_user_invitations" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "idx_internal_user_invitations_status" ON "internal_user_invitations" USING btree ("status");