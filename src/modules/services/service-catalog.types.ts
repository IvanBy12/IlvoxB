import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { AuditContext } from "../../common/audit/audit.js";

export const SERVICE_CATEGORIES = [
  "development",
  "ecommerce",
  "digital_presence",
  "automation",
  "support",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export interface ServiceCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly category: ServiceCategory;
  readonly description: string;
  readonly isPublic: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ServiceCatalogListInput extends PaginationInput {
  readonly search?: string;
  readonly category?: ServiceCategory;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
}

export interface ServiceCatalogCreateInput {
  readonly name: string;
  readonly category: ServiceCategory;
  readonly description: string;
  readonly isPublic: boolean;
  readonly isActive: boolean;
}

export interface ServiceCatalogPatch {
  readonly name?: string;
  readonly category?: ServiceCategory;
  readonly description?: string;
  readonly isPublic?: boolean;
  readonly isActive?: boolean;
}

export interface ServiceCatalogRepository {
  listPublic(input: ServiceCatalogListInput): Promise<PaginatedResult<ServiceCatalogItem>>;
  findPublicById(serviceId: string): Promise<ServiceCatalogItem | null>;
  listAuthorized(
    scope: AuthorizedRepositoryScope,
    input: ServiceCatalogListInput,
  ): Promise<PaginatedResult<ServiceCatalogItem>>;
  findAuthorizedById(
    scope: AuthorizedRepositoryScope,
    serviceId: string,
  ): Promise<ServiceCatalogItem | null>;
  createAuthorized(
    scope: AuthorizedRepositoryScope,
    input: ServiceCatalogCreateInput,
    audit: AuditContext,
  ): Promise<ServiceCatalogItem | "duplicate">;
  updateAuthorized(
    scope: AuthorizedRepositoryScope,
    serviceId: string,
    input: ServiceCatalogPatch,
    audit: AuditContext,
  ): Promise<ServiceCatalogItem | "duplicate" | null>;
}
