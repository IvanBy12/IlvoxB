import type { ActorContext } from "../../common/auth/authorization.types.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type {
  ServiceCatalogCreateInput,
  ServiceCatalogListInput,
  ServiceCatalogPatch,
  ServiceCatalogRepository,
} from "./service-catalog.types.js";
import type { AuditContext } from "../../common/audit/audit.js";

export class ServiceCatalogService {
  constructor(
    private readonly repository: ServiceCatalogRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  listPublic(input: ServiceCatalogListInput) {
    return this.repository.listPublic(input);
  }

  async getPublic(serviceId: string) {
    const service = await this.repository.findPublicById(serviceId);
    if (service === null) throw this.notFound();
    return service;
  }

  listAdmin(actor: ActorContext, input: ServiceCatalogListInput) {
    const decision = this.authorization.assertAllowed({
      actor,
      action: "services.read",
      requestedScope: "global",
      resourceType: "service",
    });
    return this.repository.listAuthorized(decision.repositoryScope!, input);
  }

  async getAdmin(actor: ActorContext, serviceId: string) {
    const decision = this.authorization.assertAllowed({
      actor,
      action: "services.read",
      requestedScope: "global",
      resourceType: "service",
      resourceId: serviceId,
    });
    const service = await this.repository.findAuthorizedById(decision.repositoryScope!, serviceId);
    if (service === null) throw this.notFound();
    return service;
  }

  async createAdmin(
    actor: ActorContext,
    input: ServiceCatalogCreateInput,
    audit: AuditContext,
  ) {
    const scope = this.manageScope(actor);
    const result = await this.repository.createAuthorized(scope, {
      ...input,
      name: input.name.trim(),
      description: input.description.trim(),
    }, audit);
    if (result === "duplicate") throw this.duplicate();
    return result;
  }

  async updateAdmin(
    actor: ActorContext,
    serviceId: string,
    input: ServiceCatalogPatch,
    audit: AuditContext,
  ) {
    const scope = this.manageScope(actor, serviceId);
    const result = await this.repository.updateAuthorized(scope, serviceId, {
      ...input,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
    }, audit);
    if (result === null) throw this.notFound();
    if (result === "duplicate") throw this.duplicate();
    return result;
  }

  private manageScope(actor: ActorContext, serviceId?: string) {
    if (!actor.internal) {
      throw new AppError({
        code: ErrorCode.Forbidden,
        message: "Operation is not allowed",
        statusCode: 403,
      });
    }
    return this.authorization.assertAllowed({
      actor,
      action: "services.manage",
      requestedScope: "global",
      resourceType: "service",
      ...(serviceId === undefined ? {} : { resourceId: serviceId }),
    }).repositoryScope!;
  }

  private notFound(): AppError {
    return new AppError({
      code: ErrorCode.NotFound,
      message: "Service not found",
      statusCode: 404,
    });
  }

  private duplicate(): AppError {
    return new AppError({
      code: ErrorCode.Conflict,
      message: "Service name already exists",
      statusCode: 409,
    });
  }
}
