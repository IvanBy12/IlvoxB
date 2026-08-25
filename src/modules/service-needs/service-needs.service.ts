import type { AuditContext } from "../../common/audit/audit.js";
import type { ActorContext } from "../../common/auth/authorization.types.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type {
  ServiceNeedCreateInput,
  ServiceNeedLinkInput,
  ServiceNeedListInput,
  ServiceNeedPatch,
  ServiceNeedRepository,
} from "./service-needs.types.js";

export class ServiceNeedService {
  constructor(
    private readonly repository: ServiceNeedRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  listPublic(input: ServiceNeedListInput) {
    return this.repository.listPublic(input);
  }

  async getPublic(needId: string) {
    const need = await this.repository.findPublicById(needId);
    if (need === null) throw this.notFound();
    return need;
  }

  async listPublicServices(needId: string) {
    if (await this.repository.findPublicById(needId) === null) throw this.notFound();
    return this.repository.listPublicServices(needId);
  }

  listAdmin(actor: ActorContext, input: ServiceNeedListInput) {
    const scope = this.authorization.assertAllowed({
      actor,
      action: "services.read",
      requestedScope: "global",
      resourceType: "service_need",
    }).repositoryScope!;
    return this.repository.listAuthorized(scope, input);
  }

  async getAdmin(actor: ActorContext, needId: string) {
    const scope = this.authorization.assertAllowed({
      actor,
      action: "services.read",
      requestedScope: "global",
      resourceType: "service_need",
      resourceId: needId,
    }).repositoryScope!;
    const need = await this.repository.findAuthorizedById(scope, needId);
    if (need === null) throw this.notFound();
    return need;
  }

  async createAdmin(actor: ActorContext, input: ServiceNeedCreateInput, audit: AuditContext) {
    const result = await this.repository.createAuthorized(this.manageScope(actor), this.normalize(input), audit);
    if (result === "duplicate") throw this.duplicate();
    return result;
  }

  async updateAdmin(actor: ActorContext, needId: string, input: ServiceNeedPatch, audit: AuditContext) {
    const result = await this.repository.updateAuthorized(this.manageScope(actor, needId), needId, this.normalizePatch(input), audit);
    if (result === null) throw this.notFound();
    if (result === "duplicate") throw this.duplicate();
    return result;
  }

  async replaceServices(actor: ActorContext, needId: string, links: readonly ServiceNeedLinkInput[], audit: AuditContext) {
    if (new Set(links.map((link) => link.serviceId)).size !== links.length) {
      throw new AppError({ code: ErrorCode.ValidationError, message: "Each service can only be linked once", statusCode: 400 });
    }
    const result = await this.repository.replaceLinksAuthorized(this.manageScope(actor, needId), needId, links, audit);
    if (result === null) throw this.notFound();
    if (result === "service_not_found") {
      throw new AppError({ code: ErrorCode.ValidationError, message: "One or more services do not exist", statusCode: 400 });
    }
    return result;
  }

  private manageScope(actor: ActorContext, needId?: string) {
    if (!actor.internal) {
      throw new AppError({ code: ErrorCode.Forbidden, message: "Operation is not allowed", statusCode: 403 });
    }
    return this.authorization.assertAllowed({
      actor,
      action: "services.manage",
      requestedScope: "global",
      resourceType: "service_need",
      ...(needId === undefined ? {} : { resourceId: needId }),
    }).repositoryScope!;
  }

  private normalize(input: ServiceNeedCreateInput): ServiceNeedCreateInput {
    return {
      ...input,
      code: input.code.trim().toLowerCase(),
      title: input.title.trim(),
      shortDescription: input.shortDescription.trim(),
      detailedDescription: input.detailedDescription.trim(),
      iconKey: input.iconKey.trim().toLowerCase(),
    };
  }

  private normalizePatch(input: ServiceNeedPatch): ServiceNeedPatch {
    return {
      ...input,
      ...(input.code === undefined ? {} : { code: input.code.trim().toLowerCase() }),
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.shortDescription === undefined ? {} : { shortDescription: input.shortDescription.trim() }),
      ...(input.detailedDescription === undefined ? {} : { detailedDescription: input.detailedDescription.trim() }),
      ...(input.iconKey === undefined ? {} : { iconKey: input.iconKey.trim().toLowerCase() }),
    };
  }

  private notFound() {
    return new AppError({ code: ErrorCode.NotFound, message: "Service need not found", statusCode: 404 });
  }

  private duplicate() {
    return new AppError({ code: ErrorCode.Conflict, message: "Service need code or title already exists", statusCode: 409 });
  }
}
