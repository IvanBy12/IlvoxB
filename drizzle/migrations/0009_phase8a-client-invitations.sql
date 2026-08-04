CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"membership_role" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"clerk_invitation_id" varchar(255),
	"invited_by_user_id" uuid NOT NULL,
	"accepted_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_organization_invitations_email_not_blank" CHECK (btrim("organization_invitations"."email") <> '' AND btrim("organization_invitations"."normalized_email") <> ''),
	CONSTRAINT "chk_organization_invitations_email_normalized" CHECK ("organization_invitations"."normalized_email" = lower(btrim("organization_invitations"."email"))),
	CONSTRAINT "chk_organization_invitations_membership_role" CHECK ("organization_invitations"."membership_role" IN ('client_manager', 'client_contact')),
	CONSTRAINT "chk_organization_invitations_status" CHECK ("organization_invitations"."status" IN ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "chk_organization_invitations_lifecycle" CHECK ((
        ("organization_invitations"."status" IN ('pending', 'expired') AND "organization_invitations"."accepted_by_user_id" IS NULL AND "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."revoked_at" IS NULL)
        OR
        ("organization_invitations"."status" = 'accepted' AND "organization_invitations"."accepted_by_user_id" IS NOT NULL AND "organization_invitations"."accepted_at" IS NOT NULL AND "organization_invitations"."revoked_at" IS NULL)
        OR
        ("organization_invitations"."status" = 'revoked' AND "organization_invitations"."accepted_by_user_id" IS NULL AND "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."revoked_at" IS NOT NULL)
      )),
	CONSTRAINT "chk_organization_invitations_expiration" CHECK ("organization_invitations"."expires_at" > "organization_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organization_invitations_pending_email" ON "organization_invitations" USING btree ("organization_id","normalized_email") WHERE "organization_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organization_invitations_clerk_id" ON "organization_invitations" USING btree ("clerk_invitation_id") WHERE "organization_invitations"."clerk_invitation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_organization_invitations_organization" ON "organization_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_organization_invitations_email" ON "organization_invitations" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "idx_organization_invitations_status" ON "organization_invitations" USING btree ("status");