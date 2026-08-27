import type { AuditContext } from "../../common/audit/audit.js";

export type InternalInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface AssignableInternalRole {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
}

export interface InternalInvitation {
  readonly id: string;
  readonly email: string;
  readonly roleCode: string;
  readonly roleName: string;
  readonly status: InternalInvitationStatus;
  readonly clerkInvitationId: string | null;
  readonly invitedByUserId: string;
  readonly acceptedByUserId: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type InternalInvitationCreateResult = {
  readonly invitation: InternalInvitation;
  readonly outcome: "invitation_sent" | "existing_account_granted";
};

export type GrantExistingInternalResult =
  | { readonly kind: "granted"; readonly invitation: InternalInvitation }
  | { readonly kind: "not_synchronized" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "already_internal" }
  | { readonly kind: "ineligible_profile" };

export type InternalClaimResult =
  | { readonly kind: "claimed" | "already_claimed"; readonly invitation: InternalInvitation }
  | { readonly kind: "not_found" | "not_synchronized" | "ineligible_profile" | "email_mismatch" }
  | { readonly kind: "expired" | "revoked" | "used" };

export type BeginInternalResendResult =
  | { readonly kind: "created"; readonly invitation: InternalInvitation; readonly previousClerkInvitationId: string | null }
  | { readonly kind: "already_replaced"; readonly invitation: InternalInvitation }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" };

export interface InternalInvitationRepository {
  listAssignableRoles(actorUserId: string): Promise<readonly AssignableInternalRole[]>;
  findAssignableRole(actorUserId: string, roleCode: string): Promise<AssignableInternalRole | null>;
  list(): Promise<readonly InternalInvitation[]>;
  reserve(input: {
    readonly email: string;
    readonly normalizedEmail: string;
    readonly roleId: string;
    readonly invitedByUserId: string;
    readonly expiresAt: Date;
  }): Promise<InternalInvitation | "duplicate">;
  finalizeDelivery(invitationId: string, clerkInvitationId: string, audit: AuditContext): Promise<InternalInvitation>;
  cancelDelivery(invitationId: string): Promise<void>;
  grantExisting(input: {
    readonly email: string;
    readonly normalizedEmail: string;
    readonly roleId: string;
    readonly invitedByUserId: string;
    readonly clerkUserId: string;
    readonly expiresAt: Date;
  }, audit: AuditContext): Promise<GrantExistingInternalResult>;
  beginResend(invitationId: string, invitedByUserId: string, expiresAt: Date): Promise<BeginInternalResendResult>;
  finalizeResend(invitationId: string, clerkInvitationId: string, audit: AuditContext): Promise<InternalInvitation>;
  revoke(invitationId: string, audit: AuditContext): Promise<InternalInvitation | "not_found" | "invalid_state">;
  claim(invitationId: string, clerkUserId: string, verifiedEmails: readonly string[], audit: AuditContext): Promise<InternalClaimResult>;
}
