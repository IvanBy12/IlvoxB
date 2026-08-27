import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type { ClerkInvitationGateway } from "../client-invitations/client-invitation.types.js";
import type {
  InternalInvitationCreateResult,
  InternalInvitationRepository,
} from "./internal-invitation.types.js";

const EXPIRATION_DAYS = 30;
const EXPIRATION_MILLISECONDS = EXPIRATION_DAYS * 24 * 60 * 60 * 1_000;

export class InternalInvitationService {
  constructor(
    private readonly repository: InternalInvitationRepository,
    private readonly authorization: AuthorizationService,
    private readonly clerk: ClerkInvitationGateway,
    private readonly clientAppOrigin: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listRoles(actor: ActorContext) {
    this.assertManager(actor);
    return this.repository.listAssignableRoles(actor.localUserId);
  }

  list(actor: ActorContext) {
    this.assertManager(actor);
    return this.repository.list();
  }

  async create(
    actor: ActorContext,
    input: { readonly email: string; readonly roleCode: string },
    audit: AuditContext,
  ): Promise<InternalInvitationCreateResult> {
    this.assertManager(actor);
    const role = await this.repository.findAssignableRole(actor.localUserId, input.roleCode);
    if (role === null) throw this.roleNotAssignable();
    const email = input.email.trim();
    const normalizedEmail = email.toLowerCase();
    const expiresAt = this.expiration();
    const existing = await this.clerk.findVerifiedUserByEmail(normalizedEmail);
    if (existing !== null) {
      const result = await this.repository.grantExisting({
        email,
        normalizedEmail,
        roleId: role.id,
        invitedByUserId: actor.localUserId,
        clerkUserId: existing.clerkUserId,
        expiresAt,
      }, audit);
      if (result.kind === "not_synchronized") throw this.notSynchronized();
      if (result.kind === "duplicate") throw this.conflict("A pending internal invitation already exists for this email");
      if (result.kind === "already_internal") throw this.conflict("The account already has internal access");
      if (result.kind === "ineligible_profile") throw this.inactiveProfile();
      return { invitation: result.invitation, outcome: "existing_account_granted" };
    }
    const reserved = await this.repository.reserve({
      email,
      normalizedEmail,
      roleId: role.id,
      invitedByUserId: actor.localUserId,
      expiresAt,
    });
    if (reserved === "duplicate") throw this.conflict("A pending internal invitation already exists for this email");
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
        message: "The internal invitation could not be issued for this email",
        statusCode: 409,
        cause,
      });
    }
  }

  async resend(actor: ActorContext, invitationId: string, audit: AuditContext) {
    this.assertManager(actor);
    const source = (await this.repository.list()).find((invitation) => invitation.id === invitationId);
    if (source === undefined) throw this.notFound();
    if (await this.repository.findAssignableRole(actor.localUserId, source.roleCode) === null) {
      throw this.forbidden();
    }
    const result = await this.repository.beginResend(
      invitationId,
      actor.localUserId,
      this.expiration(),
    );
    if (result.kind === "not_found") throw this.notFound();
    if (result.kind === "invalid_state") throw this.conflict("Only pending or expired internal invitations can be resent");
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
        message: "The internal invitation could not be resent",
        statusCode: 409,
        cause,
      });
    }
  }

  async revoke(actor: ActorContext, invitationId: string, audit: AuditContext) {
    this.assertManager(actor);
    const result = await this.repository.revoke(invitationId, audit);
    if (result === "not_found") throw this.notFound();
    if (result === "invalid_state") throw this.conflict("Only pending internal invitations can be revoked");
    if (result.clerkInvitationId !== null) {
      try {
        await this.clerk.revokeInvitation(result.clerkInvitationId);
      } catch (cause) {
        throw new AppError({
          code: ErrorCode.InternalError,
          message: "The internal invitation was disabled locally but Clerk revocation is still pending",
          statusCode: 502,
          cause,
        });
      }
    }
    return result;
  }

  async claim(clerkUserId: string, invitationId: string, audit: AuditContext) {
    const verifiedEmails = await this.clerk.getVerifiedEmails(clerkUserId);
    const result = await this.repository.claim(invitationId, clerkUserId, verifiedEmails, audit);
    switch (result.kind) {
      case "claimed":
      case "already_claimed":
        return {
          invitation: result.invitation,
          alreadyClaimed: result.kind === "already_claimed",
          audience: "internal" as const,
        };
      case "not_synchronized": throw this.notSynchronized();
      case "ineligible_profile": throw this.inactiveProfile();
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
        throw new AppError({ code: ErrorCode.InvitationInvalid, message: "The invitation is invalid", statusCode: 404 });
    }
  }

  private assertManager(actor: ActorContext): void {
    if (!actor.internal) throw this.forbidden();
    this.authorization.assertAllowed({
      actor,
      action: "users.manage",
      requestedScope: "global",
      resourceType: "internal_user_invitation",
    });
  }

  private expiration(): Date {
    return new Date(this.now().getTime() + EXPIRATION_MILLISECONDS);
  }

  private redirectUrl(invitationId: string): string {
    const url = new URL("/invitacion/aceptar", this.clientAppOrigin);
    url.searchParams.set("ilvox_internal_invitation", invitationId);
    return url.toString();
  }

  private roleNotAssignable(): AppError {
    return new AppError({
      code: ErrorCode.ValidationError,
      message: "The requested internal role is not assignable",
      statusCode: 400,
    });
  }

  private notSynchronized(): AppError {
    return new AppError({
      code: ErrorCode.ProfileNotSynchronized,
      message: "Local profile is not synchronized yet",
      statusCode: 409,
      details: { retryable: true },
    });
  }

  private inactiveProfile(): AppError {
    return new AppError({
      code: ErrorCode.ProfileInactive,
      message: "A blocked or deleted profile cannot receive internal access",
      statusCode: 403,
    });
  }

  private notFound(): AppError {
    return new AppError({ code: ErrorCode.NotFound, message: "Internal invitation not found", statusCode: 404 });
  }

  private forbidden(): AppError {
    return new AppError({ code: ErrorCode.Forbidden, message: "Operation is not allowed", statusCode: 403 });
  }

  private conflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }
}
