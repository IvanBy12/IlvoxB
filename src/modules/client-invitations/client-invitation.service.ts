import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type {
  ClientInvitationCreateResult,
  ClientInvitationRepository,
  ClientInvitationRole,
  ClerkInvitationGateway,
} from "./client-invitation.types.js";

const EXPIRATION_DAYS = 30;
const EXPIRATION_MILLISECONDS = EXPIRATION_DAYS * 24 * 60 * 60 * 1_000;

export class ClientInvitationService {
  constructor(
    private readonly repository: ClientInvitationRepository,
    private readonly authorization: AuthorizationService,
    private readonly clerk: ClerkInvitationGateway,
    private readonly clientAppOrigin: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(actor: ActorContext, organizationId: string) {
    const result = await this.repository.listAuthorized(this.scope(actor, organizationId), organizationId);
    if (result === null) throw this.organizationNotFound();
    return result;
  }

  async create(
    actor: ActorContext,
    organizationId: string,
    input: { readonly email: string; readonly membershipRole: ClientInvitationRole },
    audit: AuditContext,
  ): Promise<ClientInvitationCreateResult> {
    const scope = this.scope(actor, organizationId);
    const email = input.email.trim();
    const normalizedEmail = email.toLowerCase();
    if (await this.repository.actorOwnsEmail(actor.localUserId, normalizedEmail)) {
      throw this.forbidden();
    }
    const expiresAt = this.expiration();
    const existing = await this.clerk.findVerifiedUserByEmail(normalizedEmail);
    if (existing !== null) {
      const result = await this.repository.grantExisting(scope, {
        organizationId,
        email,
        normalizedEmail,
        membershipRole: input.membershipRole,
        invitedByUserId: actor.localUserId,
        identity: existing,
        expiresAt,
      }, audit);
      if (result.kind === "organization_not_found") throw this.organizationNotFound();
      if (result.kind === "duplicate") {
        throw this.conflict("A pending invitation already exists for this email and organization");
      }
      if (result.kind === "already_member") {
        throw this.conflict("The account already has active access to this organization");
      }
      if (result.kind === "ineligible_profile") throw this.inactiveProfile();
      return { invitation: result.invitation, outcome: "existing_account_granted" };
    }

    const reserved = await this.repository.reserve(scope, {
      organizationId,
      email,
      normalizedEmail,
      membershipRole: input.membershipRole,
      invitedByUserId: actor.localUserId,
      expiresAt,
    });
    if (reserved === null) throw this.organizationNotFound();
    if (reserved === "duplicate") {
      throw this.conflict("A pending invitation already exists for this email and organization");
    }
    try {
      const official = await this.clerk.createInvitation({
        email,
        redirectUrl: this.redirectUrl(reserved.id),
        expiresInDays: EXPIRATION_DAYS,
      });
      return {
        invitation: await this.repository.finalizeDelivery(reserved.id, official.id, audit),
        outcome: "invitation_sent",
      };
    } catch (cause) {
      await this.repository.cancelDelivery(reserved.id);
      throw new AppError({
        code: ErrorCode.Conflict,
        message: "The invitation could not be issued for this email",
        statusCode: 409,
        cause,
      });
    }
  }

  async resend(
    actor: ActorContext,
    organizationId: string,
    invitationId: string,
    audit: AuditContext,
  ) {
    const result = await this.repository.beginResend(
      this.scope(actor, organizationId),
      organizationId,
      invitationId,
      actor.localUserId,
      this.expiration(),
    );
    if (result.kind === "organization_not_found") throw this.organizationNotFound();
    if (result.kind === "invitation_not_found") throw this.invitationNotFound();
    if (result.kind === "invalid_state") {
      throw this.conflict("Only pending or expired invitations can be resent");
    }
    if (result.kind === "already_replaced") return result.invitation;
    try {
      if (result.previousClerkInvitationId !== null) {
        await this.clerk.revokeInvitation(result.previousClerkInvitationId);
      }
      const official = await this.clerk.createInvitation({
        email: result.invitation.email,
        redirectUrl: this.redirectUrl(result.invitation.id),
        expiresInDays: EXPIRATION_DAYS,
      });
      return this.repository.finalizeResend(result.invitation.id, official.id, audit);
    } catch (cause) {
      await this.repository.cancelDelivery(result.invitation.id);
      throw new AppError({
        code: ErrorCode.Conflict,
        message: "The invitation could not be resent",
        statusCode: 409,
        cause,
      });
    }
  }

  async revoke(
    actor: ActorContext,
    organizationId: string,
    invitationId: string,
    audit: AuditContext,
  ) {
    const result = await this.repository.revokeAuthorized(
      this.scope(actor, organizationId),
      organizationId,
      invitationId,
      audit,
    );
    if (result === "organization_not_found") throw this.organizationNotFound();
    if (result === "invitation_not_found") throw this.invitationNotFound();
    if (result === "invalid_state") {
      throw this.conflict("Only pending invitations can be revoked");
    }
    if (result.clerkInvitationId !== null) {
      try {
        await this.clerk.revokeInvitation(result.clerkInvitationId);
      } catch (cause) {
        throw new AppError({
          code: ErrorCode.InternalError,
          message: "The invitation was disabled locally but Clerk revocation is still pending",
          statusCode: 502,
          cause,
        });
      }
    }
    return result;
  }

  async claim(clerkUserId: string, invitationId: string, audit: AuditContext) {
    const identity = await this.clerk.getVerifiedUser(clerkUserId);
    const result = await this.repository.claim(invitationId, identity, audit);
    switch (result.kind) {
      case "claimed":
      case "already_claimed":
        return {
          invitation: result.invitation,
          alreadyClaimed: result.kind === "already_claimed",
          profileExisted: result.profileExisted,
          reconciliationAttempted: result.reconciliationAttempted,
          membershipCreated: result.membershipCreated,
        };
      case "ineligible_profile":
        throw this.inactiveProfile();
      case "email_mismatch":
        throw new AppError({
          code: ErrorCode.InvitationEmailMismatch,
          message: "The authenticated email does not match the invitation",
          statusCode: 403,
        });
      case "expired":
        throw new AppError({ code: ErrorCode.InvitationExpired, message: "The invitation expired", statusCode: 409 });
      case "revoked":
        throw new AppError({ code: ErrorCode.InvitationRevoked, message: "The invitation was revoked", statusCode: 409 });
      case "used":
        throw new AppError({ code: ErrorCode.InvitationUsed, message: "The invitation was already used", statusCode: 409 });
      case "not_found":
        throw this.invitationNotFound();
    }
  }

  private scope(actor: ActorContext, organizationId: string): AuthorizedRepositoryScope {
    if (!actor.internal) throw this.forbidden();
    return this.authorization.assertAllowed({
      actor,
      action: "organization_members.manage",
      organizationId,
      resourceType: "organization_invitation",
      requestedRole: { scope: "organization", code: "client_contact" },
    }).repositoryScope!;
  }

  private expiration(): Date {
    return new Date(this.now().getTime() + EXPIRATION_MILLISECONDS);
  }

  private redirectUrl(invitationId: string): string {
    const url = new URL("/invitacion/aceptar", this.clientAppOrigin);
    url.searchParams.set("ilvox_invitation", invitationId);
    return url.toString();
  }

  private organizationNotFound(): AppError {
    return new AppError({
      code: ErrorCode.OrganizationNotFound,
      message: "Active organization not found",
      statusCode: 404,
    });
  }

  private invitationNotFound(): AppError {
    return new AppError({
      code: ErrorCode.InvitationNotFound,
      message: "Invitation not found",
      statusCode: 404,
    });
  }

  private forbidden(): AppError {
    return new AppError({ code: ErrorCode.Forbidden, message: "Operation is not allowed", statusCode: 403 });
  }

  private conflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }

  private inactiveProfile(): AppError {
    return new AppError({
      code: ErrorCode.ProfileInactive,
      message: "A blocked or deleted profile cannot receive access",
      statusCode: 403,
    });
  }
}
