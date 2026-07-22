export type LocalUserStatus = "pending" | "active" | "blocked" | "deleted";
export type RoleScope = "global" | "organization" | "project";
export type AccessScope = "global" | "organization" | "assigned" | "own" | "public";

export interface OrganizationMembershipContext {
  readonly organizationId: string;
  readonly roleId: string;
  readonly roleCode: string;
  readonly status: "active";
}

export interface RoleContext {
  readonly roleId: string;
  readonly code: string;
  readonly scope: RoleScope;
  readonly organizationId?: string;
  readonly projectId?: string;
}

export interface PermissionContext {
  readonly code: string;
  readonly scopes: readonly AccessScope[];
  /** Active organization grants, partitioned by scope to avoid permission union leaks. */
  readonly scopeOrganizationIds?: Readonly<Partial<Record<AccessScope, readonly string[]>>>;
}

export interface ActorContext {
  readonly clerkUserId: string;
  readonly localUserId: string;
  readonly status: LocalUserStatus;
  readonly internal: boolean;
  readonly memberships: readonly OrganizationMembershipContext[];
  readonly roles: readonly RoleContext[];
  readonly permissions: readonly PermissionContext[];
}

export type AuthorizedRepositoryScope =
  | { readonly kind: "global"; readonly actorId: string; readonly crossOrganization: true }
  | { readonly kind: "organization"; readonly actorId: string; readonly organizationIds: readonly string[] }
  | { readonly kind: "assigned"; readonly actorId: string; readonly organizationIds: readonly string[] }
  | { readonly kind: "own"; readonly actorId: string; readonly organizationIds: readonly string[] }
  | { readonly kind: "public"; readonly actorId?: string };

export interface AuthorizationRequest {
  readonly actor: ActorContext;
  readonly action: string;
  readonly requestedScope?: AccessScope;
  readonly organizationId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly resourceOwnerId?: string;
  readonly resourceAssigneeIds?: readonly string[];
  readonly resourceState?: string;
  readonly requestedRole?: { readonly scope: RoleScope; readonly code: string };
  readonly idempotencyKey?: string;
}

export type AuthorizationReasonCode =
  | "ALLOW"
  | "ACTOR_INACTIVE"
  | "MEMBERSHIP_REQUIRED"
  | "PERMISSION_DENIED"
  | "SCOPE_MISMATCH"
  | "ORGANIZATION_MISMATCH"
  | "RESOURCE_NOT_AUTHORIZED"
  | "RESOURCE_STATE_INVALID"
  | "PRIVILEGE_BOUNDARY"
  | "LAST_SUPER_ADMIN_PROTECTED";

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reasonCode: AuthorizationReasonCode;
  readonly appliedScope?: AccessScope;
  readonly repositoryScope?: AuthorizedRepositoryScope;
  readonly auditRequired: boolean;
}
