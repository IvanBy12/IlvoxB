import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type {
  OrganizationCreateInput,
  OrganizationListInput,
  OrganizationMemberCreate,
  OrganizationMemberPatch,
  OrganizationPatch,
  OrganizationRepository,
} from "./organization.types.js";

const CLIENT_EDITABLE_FIELDS = new Set(["name", "industry", "size"]);

export class OrganizationService {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  list(actor: ActorContext, input: OrganizationListInput) {
    const initial = this.scope(actor, "organizations.read");
    const canAccessAll = actor.permissions.some((permission) =>
      permission.code === "organizations.access_all" && permission.scopes.includes("global"));
    const repositoryScope = initial.kind === "global" && !canAccessAll
      ? this.authorization.assertAllowed({
          actor,
          action: "organizations.read",
          requestedScope: "organization",
          resourceType: "organization",
        }).repositoryScope!
      : initial;
    return this.repository.listAuthorized(repositoryScope, input);
  }

  async get(actor: ActorContext, organizationId: string) {
    const organization = await this.repository.findAuthorized(
      this.scope(actor, "organizations.read", organizationId),
      organizationId,
    );
    if (organization === null) throw this.notFound();
    return organization;
  }

  async create(actor: ActorContext, input: OrganizationCreateInput, audit: AuditContext) {
    if (!actor.internal) throw this.forbidden();
    this.scope(actor, "organizations.manage");
    this.assertTaxPair(input.countryCode, input.taxId);
    return this.unwrapWriteResult(await this.repository.create(this.normalizedCreate(input), audit));
  }

  async update(
    actor: ActorContext,
    organizationId: string,
    input: OrganizationPatch,
    audit: AuditContext,
  ) {
    if (!actor.internal) {
      const forbiddenField = Object.entries(input)
        .find(([key, value]) => value !== undefined && !CLIENT_EDITABLE_FIELDS.has(key));
      if (forbiddenField !== undefined) throw this.forbidden();
    }
    if (input.taxId !== undefined || input.countryCode !== undefined) {
      this.assertTaxPair(input.countryCode, input.taxId);
    }
    const result = await this.repository.updateAuthorized(
      this.scope(actor, "organizations.manage", organizationId),
      organizationId,
      input,
      audit,
    );
    if (result === null) throw this.notFound();
    return this.unwrapWriteResult(result);
  }

  async listMembers(actor: ActorContext, organizationId: string) {
    const result = await this.repository.listMembers(
      this.scope(actor, "organizations.read", organizationId),
      organizationId,
    );
    if (result === null) throw this.notFound();
    return result;
  }

  async createMember(
    actor: ActorContext,
    organizationId: string,
    input: OrganizationMemberCreate,
    audit: AuditContext,
  ) {
    const scope = this.memberScope(actor, organizationId, input.roleCode);
    const result = await this.repository.createMember(scope, organizationId, input, audit);
    if (result === null) throw this.notFound();
    if (result === "duplicate") throw this.conflict("Membership already exists");
    if (result === "ineligible_user") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Local user status is not eligible for the requested membership status",
        statusCode: 400,
      });
    }
    return result;
  }

  async updateMember(
    actor: ActorContext,
    organizationId: string,
    userId: string,
    input: OrganizationMemberPatch,
    audit: AuditContext,
  ) {
    const requestedRole = input.roleCode ?? "client_contact";
    const scope = this.memberScope(actor, organizationId, requestedRole);
    const result = await this.repository.updateMember(scope, organizationId, userId, input, audit);
    if (result === null) throw this.notFound();
    if (result === "ineligible_user") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "A blocked, deleted, or pending local user cannot receive active access",
        statusCode: 400,
      });
    }
    return result;
  }

  private scope(
    actor: ActorContext,
    action: "organizations.read" | "organizations.manage",
    organizationId?: string,
  ): AuthorizedRepositoryScope {
    return this.authorization.assertAllowed({
      actor,
      action,
      ...(organizationId === undefined ? {} : { organizationId, resourceId: organizationId }),
      resourceType: "organization",
    }).repositoryScope!;
  }

  private memberScope(
    actor: ActorContext,
    organizationId: string,
    roleCode: "client_manager" | "client_contact",
  ): AuthorizedRepositoryScope {
    return this.authorization.assertAllowed({
      actor,
      action: "organization_members.manage",
      organizationId,
      resourceType: "organization_membership",
      requestedRole: { scope: "organization", code: roleCode },
    }).repositoryScope!;
  }

  private normalizedCreate(input: OrganizationCreateInput): OrganizationCreateInput {
    return {
      ...input,
      name: input.name.trim(),
      ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode.toUpperCase() }),
    };
  }

  private assertTaxPair(
    countryCode: string | null | undefined,
    taxId: string | null | undefined,
  ): void {
    if ((countryCode === undefined && taxId === undefined) || (countryCode === null && taxId === null)) return;
    if (countryCode === undefined || countryCode === null || taxId === undefined || taxId === null) {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "countryCode and taxId must be provided or cleared together",
        statusCode: 400,
      });
    }
  }

  private unwrapWriteResult<T>(
    result: T | "duplicate" | "ineligible_manager",
  ): T {
    if (result === "duplicate") throw this.conflict("Organization business identifier already exists");
    if (result === "ineligible_manager") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Account manager is not an active internal user",
        statusCode: 400,
      });
    }
    return result;
  }

  private notFound(): AppError {
    return new AppError({
      code: ErrorCode.NotFound,
      message: "Organization or membership not found",
      statusCode: 404,
    });
  }

  private forbidden(): AppError {
    return new AppError({
      code: ErrorCode.Forbidden,
      message: "Operation is not allowed",
      statusCode: 403,
    });
  }

  private conflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }
}
