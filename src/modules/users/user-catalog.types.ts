import type { AuthorizedRepositoryScope, LocalUserStatus } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { AuditContext } from "../../common/audit/audit.js";

export const ELIGIBLE_USER_PURPOSES = [
  "organization_account_manager",
  "project_lead",
  "project_member",
  "task_assignee",
  "ticket_assignee",
  "lead_assignee",
] as const;

export type EligibleUserPurpose = (typeof ELIGIBLE_USER_PURPOSES)[number];
export type UserCatalogType = "internal" | "client";

export interface UserCatalogItem {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: LocalUserStatus;
  readonly isInternal: boolean;
  readonly roles: readonly string[];
  readonly internalRoles: readonly string[];
  readonly hasClientAccess: boolean;
  readonly createdAt: Date;
  readonly lastAccessAt: Date | null;
}

export interface UserCatalogDetail extends UserCatalogItem {
  readonly identitySynchronized: boolean;
  readonly effectivePermissions: readonly string[];
}

export interface UserCatalogSummary {
  readonly active: number;
  readonly pending: number;
  readonly blocked: number;
  readonly deleted: number;
}

export interface UserCatalogListResult extends PaginatedResult<UserCatalogItem> {
  readonly summary: UserCatalogSummary;
}

export type UserStatusMutationResult =
  | { readonly kind: "changed" | "unchanged"; readonly user: UserCatalogDetail }
  | { readonly kind: "not_found" | "invalid_state" | "deleted" | "last_administrator" };

export type UserRoleMutationResult =
  | { readonly kind: "changed" | "unchanged"; readonly user: UserCatalogDetail }
  | { readonly kind: "not_found" | "role_not_assignable" | "protected_role" | "last_administrator" | "last_internal_role" | "deleted" };

export interface EligibleUserItem {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly roles: readonly string[];
}

export interface UserCatalogListInput extends PaginationInput {
  readonly search?: string;
  readonly status?: LocalUserStatus;
  readonly type?: UserCatalogType;
  readonly role?: string;
  readonly sortBy: "displayName" | "email" | "createdAt";
  readonly sortDirection: "asc" | "desc";
}

export interface EligibilityContext {
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly ticketId?: string;
  readonly taskId?: string;
  readonly leadId?: string;
}

export interface EligibleUserQuery extends EligibilityContext {
  readonly purpose: EligibleUserPurpose;
  readonly search?: string;
}

export interface ResolvedEligibilityContext {
  readonly organizationId?: string;
  readonly projectId?: string;
}

export interface UserCatalogRepository {
  list(input: UserCatalogListInput): Promise<UserCatalogListResult>;
  findById(userId: string): Promise<UserCatalogDetail | null>;
  activate(userId: string, actorUserId: string, audit: AuditContext): Promise<UserStatusMutationResult>;
  block(userId: string, actorUserId: string, audit: AuditContext): Promise<UserStatusMutationResult>;
  grantRole(userId: string, roleCode: string, actorUserId: string, audit: AuditContext): Promise<UserRoleMutationResult>;
  revokeRole(userId: string, roleCode: string, actorUserId: string, audit: AuditContext): Promise<UserRoleMutationResult>;
  resolveContext(
    scope: AuthorizedRepositoryScope,
    input: EligibilityContext,
  ): Promise<ResolvedEligibilityContext | null>;
  listEligible(
    purpose: EligibleUserPurpose,
    context: ResolvedEligibilityContext,
    search?: string,
  ): Promise<readonly EligibleUserItem[]>;
}
