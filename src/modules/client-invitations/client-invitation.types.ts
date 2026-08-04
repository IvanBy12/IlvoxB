import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";

export type ClientInvitationRole = "client_manager" | "client_contact";
export type ClientInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface ClientInvitation {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly membershipRole: ClientInvitationRole;
  readonly status: ClientInvitationStatus;
  readonly clerkInvitationId: string | null;
  readonly invitedByUserId: string;
  readonly invitedByEmail: string;
  readonly invitedByName: string | null;
  readonly acceptedByUserId: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClientInvitationCreateResult {
  readonly invitation: ClientInvitation;
  readonly outcome: "invitation_sent" | "existing_account_granted";
}

export interface VerifiedClerkUser {
  readonly clerkUserId: string;
  readonly verifiedEmails: readonly string[];
}

export interface ClerkInvitationGateway {
  findVerifiedUserByEmail(normalizedEmail: string): Promise<VerifiedClerkUser | null>;
  getVerifiedEmails(clerkUserId: string): Promise<readonly string[]>;
  createInvitation(input: {
    readonly email: string;
    readonly redirectUrl: string;
    readonly expiresInDays: number;
  }): Promise<{ readonly id: string }>;
  revokeInvitation(clerkInvitationId: string): Promise<void>;
}

export type GrantExistingResult =
  | { readonly kind: "granted"; readonly invitation: ClientInvitation }
  | { readonly kind: "not_found" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "already_member" }
  | { readonly kind: "ineligible_profile" };

export type ClaimResult =
  | { readonly kind: "claimed" | "already_claimed"; readonly invitation: ClientInvitation }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_synchronized" }
  | { readonly kind: "ineligible_profile" }
  | { readonly kind: "email_mismatch" }
  | { readonly kind: "expired" | "revoked" | "used" };

export type BeginResendResult =
  | { readonly kind: "created"; readonly invitation: ClientInvitation; readonly previousClerkInvitationId: string | null }
  | { readonly kind: "already_replaced"; readonly invitation: ClientInvitation }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" };

export interface ClientInvitationRepository {
  actorOwnsEmail(actorUserId: string, normalizedEmail: string): Promise<boolean>;
  listAuthorized(scope: AuthorizedRepositoryScope, organizationId: string): Promise<readonly ClientInvitation[] | null>;
  reserve(
    scope: AuthorizedRepositoryScope,
    input: { readonly organizationId: string; readonly email: string; readonly normalizedEmail: string; readonly membershipRole: ClientInvitationRole; readonly invitedByUserId: string; readonly expiresAt: Date },
  ): Promise<ClientInvitation | "duplicate" | null>;
  finalizeDelivery(invitationId: string, clerkInvitationId: string, audit: AuditContext): Promise<ClientInvitation>;
  cancelDelivery(invitationId: string): Promise<void>;
  grantExisting(
    scope: AuthorizedRepositoryScope,
    input: { readonly organizationId: string; readonly email: string; readonly normalizedEmail: string; readonly membershipRole: ClientInvitationRole; readonly invitedByUserId: string; readonly clerkUserId: string; readonly expiresAt: Date },
    audit: AuditContext,
  ): Promise<GrantExistingResult>;
  beginResend(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    invitationId: string,
    invitedByUserId: string,
    expiresAt: Date,
  ): Promise<BeginResendResult>;
  finalizeResend(invitationId: string, clerkInvitationId: string, audit: AuditContext): Promise<ClientInvitation>;
  revokeAuthorized(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    invitationId: string,
    audit: AuditContext,
  ): Promise<ClientInvitation | "not_found" | "invalid_state">;
  claim(
    invitationId: string,
    clerkUserId: string,
    verifiedEmails: readonly string[],
    audit: AuditContext,
  ): Promise<ClaimResult>;
}
