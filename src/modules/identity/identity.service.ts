import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type { ActorContext } from "../../common/auth/authorization.types.js";
import type { IdentityRepository, LocalIdentityProfile, MeResponseData } from "./identity.types.js";

export class IdentityService {
  constructor(private readonly repository: IdentityRepository) {}

  async requireActiveProfile(clerkUserId: string): Promise<LocalIdentityProfile> {
    const profile = await this.repository.findByClerkUserId(clerkUserId);
    if (profile === null) {
      throw new AppError({
        code: ErrorCode.ProfileNotSynchronized,
        message: "Local profile is not synchronized yet",
        statusCode: 403,
      });
    }
    if (profile.actor.status === "pending") {
      throw new AppError({
        code: ErrorCode.ProfilePending,
        message: "Local access is pending",
        statusCode: 403,
      });
    }
    if (profile.actor.status !== "active") {
      throw new AppError({
        code: ErrorCode.ProfileInactive,
        message: "Local access is not available",
        statusCode: 403,
      });
    }
    return profile;
  }

  async requireActor(clerkUserId: string): Promise<ActorContext> {
    return (await this.requireActiveProfile(clerkUserId)).actor;
  }

  async getMe(clerkUserId: string): Promise<MeResponseData> {
    const profile = await this.requireActiveProfile(clerkUserId);
    const permissionCodes = new Set(profile.actor.permissions.map((permission) => permission.code));
    return {
      user: {
        id: profile.actor.localUserId,
        status: "active",
        internal: profile.actor.internal,
        primaryEmail: profile.primaryEmail,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
      },
      organizations: profile.actor.memberships.map((membership) => ({
        id: membership.organizationId,
        membershipStatus: membership.status,
        role: membership.roleCode,
      })),
      roles: [...profile.actor.roles],
      effectivePermissions: profile.actor.permissions.map((permission) => ({
        code: permission.code,
        scopes: [...permission.scopes],
        ...(permission.scopeOrganizationIds === undefined
          ? {}
          : { scopeOrganizationIds: Object.fromEntries(
              Object.entries(permission.scopeOrganizationIds)
                .map(([scope, organizationIds]) => [scope, [...organizationIds]]),
            ) }),
      })),
      capabilities: {
        canCreateTicket: permissionCodes.has("tickets.create"),
        canManageMembers: permissionCodes.has("organization_members.manage"),
        canReadOrganizationFiles: permissionCodes.has("files.read_client"),
        canUploadOrganizationFiles: permissionCodes.has("files.upload_client"),
      },
    };
  }
}
