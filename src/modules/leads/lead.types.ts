import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { LeadStatus } from "../../common/state-machines/lead-transitions.js";

export const LEAD_SOURCES = ["diagnostic", "quotation", "contact", "referral", "campaign"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface LeadRecord {
  readonly id: string;
  readonly fullName: string;
  readonly companyName: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly message: string;
  readonly source: LeadSource;
  readonly status: LeadStatus;
  readonly assignedToUserId: string | null;
  readonly assignedToName: string | null;
  readonly convertedOrganizationId: string | null;
  readonly convertedOrganizationName: string | null;
  readonly convertedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LeadHistoryEntry {
  readonly action: string;
  readonly oldValues: Readonly<Record<string, unknown>> | null;
  readonly newValues: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
}

export interface LeadDetail extends LeadRecord {
  readonly history: readonly LeadHistoryEntry[];
}

export interface PublicLeadInput {
  readonly fullName: string;
  readonly companyName?: string;
  readonly email: string;
  readonly phone?: string;
  readonly serviceId?: string;
  readonly message: string;
  readonly source: LeadSource;
}

export interface LeadListInput extends PaginationInput {
  readonly search?: string;
  readonly status?: LeadStatus;
  readonly serviceId?: string;
  readonly assignedToUserId?: string;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly sortBy: "createdAt" | "updatedAt";
  readonly sortDirection: "asc" | "desc";
}

export interface LeadCommercialPatch {
  readonly fullName?: string;
  readonly companyName?: string | null;
  readonly email?: string;
  readonly phone?: string | null;
  readonly serviceId?: string | null;
  readonly message?: string;
  readonly source?: LeadSource;
}

export interface CreateOrganizationForLead {
  readonly mode: "create_organization";
  readonly name: string;
  readonly legalName?: string;
  readonly industry?: string;
  readonly size?: "micro" | "small" | "medium" | "large";
  readonly countryCode?: string;
  readonly taxId?: string;
  readonly accountManagerUserId?: string;
}

export interface ReuseOrganizationForLead {
  readonly mode: "reuse_organization";
  readonly organizationId: string;
}

export interface StandaloneLeadConversion {
  readonly mode: "standalone";
}

export type LeadConversionInput =
  | StandaloneLeadConversion
  | CreateOrganizationForLead
  | ReuseOrganizationForLead;

export interface LeadConversionResult {
  readonly mode: LeadConversionInput["mode"];
  readonly leadId: string;
  readonly organizationCreated: boolean;
  readonly organizationId: string | null;
  readonly status: "converted";
  readonly idempotent: boolean;
  readonly primaryContactCreated: false;
}

export interface LeadRepository {
  createPublic(input: PublicLeadInput, audit: AuditContext): Promise<LeadRecord>;
  listAuthorized(
    scope: AuthorizedRepositoryScope,
    input: LeadListInput,
  ): Promise<PaginatedResult<LeadRecord>>;
  findAuthorized(scope: AuthorizedRepositoryScope, leadId: string): Promise<LeadDetail | null>;
  updateCommercial(
    scope: AuthorizedRepositoryScope,
    leadId: string,
    input: LeadCommercialPatch,
    audit: AuditContext,
  ): Promise<LeadRecord | null>;
  transition(
    scope: AuthorizedRepositoryScope,
    leadId: string,
    currentStatus: LeadStatus,
    nextStatus: LeadStatus,
    reason: string | undefined,
    audit: AuditContext,
  ): Promise<LeadRecord | "concurrent" | null>;
  assign(
    scope: AuthorizedRepositoryScope,
    leadId: string,
    assignedToUserId: string,
    audit: AuditContext,
  ): Promise<LeadRecord | "ineligible" | null>;
  convert(
    leadScope: AuthorizedRepositoryScope,
    organizationScope: AuthorizedRepositoryScope | undefined,
    leadId: string,
    input: LeadConversionInput,
    audit: AuditContext,
  ): Promise<LeadConversionResult | "not_approved" | "organization_conflict" | "ineligible_manager" | null>;
}
