import type { AccessScope, ActorContext, RoleContext } from "../../common/auth/authorization.types.js";

export interface LocalIdentityProfile {
  readonly actor: ActorContext;
  readonly primaryEmail: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly avatarUrl: string | null;
}

export interface IdentityRepository {
  findByClerkUserId(clerkUserId: string): Promise<LocalIdentityProfile | null>;
}

export interface MeResponseData {
  readonly user: {
    readonly id: string;
    readonly status: "active";
    readonly internal: boolean;
    readonly primaryEmail: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly avatarUrl: string | null;
  };
  readonly organizations: {
    readonly id: string;
    readonly membershipStatus: "active";
    readonly role: string;
  }[];
  readonly roles: RoleContext[];
  readonly effectivePermissions: {
    readonly code: string;
    readonly scopes: AccessScope[];
    readonly scopeOrganizationIds?: Partial<Record<AccessScope, string[]>>;
  }[];
  readonly capabilities: {
    readonly canCreateTicket: boolean;
    readonly canManageMembers: boolean;
    readonly canReadOrganizationFiles: boolean;
    readonly canUploadOrganizationFiles: boolean;
  };
}
