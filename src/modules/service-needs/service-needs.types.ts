import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { ServiceCatalogItem } from "../services/service-catalog.types.js";

export interface ServiceNeed {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly detailedDescription: string;
  readonly iconKey: string;
  readonly displayOrder: number;
  readonly isPublic: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type PublicServiceNeed = Omit<ServiceNeed, "isPublic" | "isActive" | "createdAt" | "updatedAt">;

export type PublicRelatedService = Pick<ServiceCatalogItem, "id" | "name" | "category" | "description">;

export interface PublicServiceNeedLink {
  readonly service: PublicRelatedService;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export interface ServiceNeedLink {
  readonly service: ServiceCatalogItem;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export interface ServiceNeedDetail extends ServiceNeed {
  readonly services: readonly ServiceNeedLink[];
}

export interface ServiceNeedListInput extends PaginationInput {
  readonly search?: string;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
}

export interface ServiceNeedCreateInput {
  readonly code: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly detailedDescription: string;
  readonly iconKey: string;
  readonly displayOrder: number;
  readonly isPublic: boolean;
  readonly isActive: boolean;
}

export type ServiceNeedPatch = Partial<ServiceNeedCreateInput>;

export interface ServiceNeedLinkInput {
  readonly serviceId: string;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export interface ServiceNeedRepository {
  listPublic(input: ServiceNeedListInput): Promise<PaginatedResult<PublicServiceNeed>>;
  findPublicById(needId: string): Promise<PublicServiceNeed | null>;
  listPublicServices(needId: string): Promise<readonly PublicServiceNeedLink[]>;
  listAuthorized(scope: AuthorizedRepositoryScope, input: ServiceNeedListInput): Promise<PaginatedResult<ServiceNeed>>;
  findAuthorizedById(scope: AuthorizedRepositoryScope, needId: string): Promise<ServiceNeedDetail | null>;
  createAuthorized(scope: AuthorizedRepositoryScope, input: ServiceNeedCreateInput, audit: AuditContext): Promise<ServiceNeed | "duplicate">;
  updateAuthorized(scope: AuthorizedRepositoryScope, needId: string, input: ServiceNeedPatch, audit: AuditContext): Promise<ServiceNeed | "duplicate" | null>;
  replaceLinksAuthorized(scope: AuthorizedRepositoryScope, needId: string, links: readonly ServiceNeedLinkInput[], audit: AuditContext): Promise<ServiceNeedDetail | "service_not_found" | null>;
}
