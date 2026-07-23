import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";

export type OrganizationStatus = "active" | "inactive" | "archived";
export type OrganizationSize = "micro" | "small" | "medium" | "large";

export interface OrganizationRecord {
  readonly id: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly industry: string | null;
  readonly size: OrganizationSize | null;
  readonly status: OrganizationStatus;
  readonly countryCode: string | null;
  readonly taxId: string | null;
  readonly accountManagerUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OrganizationDetail extends OrganizationRecord {
  readonly memberCount: number;
  readonly convertedLeadCount: number;
}

export interface OrganizationListInput extends PaginationInput {
  readonly search?: string;
  readonly status?: OrganizationStatus;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

export interface OrganizationCreateInput {
  readonly name: string;
  readonly legalName?: string;
  readonly industry?: string;
  readonly size?: OrganizationSize;
  readonly countryCode?: string;
  readonly taxId?: string;
  readonly accountManagerUserId?: string;
}

export interface OrganizationPatch {
  readonly name?: string;
  readonly legalName?: string | null;
  readonly industry?: string | null;
  readonly size?: OrganizationSize | null;
  readonly status?: OrganizationStatus;
  readonly countryCode?: string | null;
  readonly taxId?: string | null;
  readonly accountManagerUserId?: string | null;
}

export interface OrganizationMember {
  readonly organizationId: string;
  readonly userId: string;
  readonly primaryEmail: string;
  readonly displayName: string | null;
  readonly roleCode: "client_manager" | "client_contact";
  readonly status: "pending" | "active" | "revoked";
  readonly jobTitle: string | null;
  readonly phone: string | null;
  readonly activatedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OrganizationMemberCreate {
  readonly userId: string;
  readonly roleCode: "client_manager" | "client_contact";
  readonly status: "pending" | "active";
  readonly jobTitle?: string;
  readonly phone?: string;
}

export interface OrganizationMemberPatch {
  readonly roleCode?: "client_manager" | "client_contact";
  readonly status?: "pending" | "active" | "revoked";
  readonly jobTitle?: string | null;
  readonly phone?: string | null;
}

export interface OrganizationRepository {
  listAuthorized(
    scope: AuthorizedRepositoryScope,
    input: OrganizationListInput,
  ): Promise<PaginatedResult<OrganizationRecord>>;
  findAuthorized(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
  ): Promise<OrganizationDetail | null>;
  create(input: OrganizationCreateInput, audit: AuditContext): Promise<OrganizationRecord | "duplicate" | "ineligible_manager">;
  updateAuthorized(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    input: OrganizationPatch,
    audit: AuditContext,
  ): Promise<OrganizationRecord | "duplicate" | "ineligible_manager" | null>;
  listMembers(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
  ): Promise<readonly OrganizationMember[] | null>;
  createMember(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    input: OrganizationMemberCreate,
    audit: AuditContext,
  ): Promise<OrganizationMember | "duplicate" | "ineligible_user" | null>;
  updateMember(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    userId: string,
    input: OrganizationMemberPatch,
    audit: AuditContext,
  ): Promise<OrganizationMember | "ineligible_user" | null>;
}
