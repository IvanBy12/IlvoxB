import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type { AuditContext } from "../../common/audit/audit.js";
import type {
  EligibilityContext,
  EligibleUserPurpose,
  EligibleUserQuery,
  UserCatalogListInput,
  UserCatalogRepository,
} from "./user-catalog.types.js";

const PURPOSE_ACTION: Readonly<Record<EligibleUserPurpose, string>> = {
  organization_account_manager: "organizations.manage",
  project_lead: "projects.manage",
  project_member: "projects.manage",
  task_assignee: "tasks.manage",
  ticket_assignee: "tickets.assign",
  lead_assignee: "leads.manage",
};

const CONTEXT_KEYS = ["organizationId", "projectId", "ticketId", "taskId", "leadId"] as const;

export class UserCatalogService {
  constructor(
    private readonly repository: UserCatalogRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  list(actor: ActorContext, input: UserCatalogListInput) {
    this.assertInternal(actor);
    this.authorization.assertAllowed({ actor, action: "users.manage", resourceType: "user" });
    return this.repository.list(input);
  }

  async get(actor: ActorContext, userId: string) {
    this.assertInternal(actor);
    this.authorization.assertAllowed({
      actor,
      action: "users.manage",
      resourceType: "user",
      resourceId: userId,
    });
    const user = await this.repository.findById(userId);
    if (user === null) throw this.notFound();
    return user;
  }

  async activate(actor: ActorContext, userId: string, audit: AuditContext) {
    this.assertManager(actor, userId);
    return this.resolveStatusMutation(await this.repository.activate(userId, actor.localUserId, audit));
  }

  async block(actor: ActorContext, userId: string, audit: AuditContext) {
    this.assertManager(actor, userId);
    return this.resolveStatusMutation(await this.repository.block(userId, actor.localUserId, audit));
  }

  async grantRole(actor: ActorContext, userId: string, roleCode: string, audit: AuditContext) {
    this.assertManager(actor, userId);
    return this.resolveRoleMutation(await this.repository.grantRole(userId, roleCode, actor.localUserId, audit));
  }

  async revokeRole(actor: ActorContext, userId: string, roleCode: string, audit: AuditContext) {
    this.assertManager(actor, userId);
    return this.resolveRoleMutation(await this.repository.revokeRole(userId, roleCode, actor.localUserId, audit));
  }

  async eligible(actor: ActorContext, input: EligibleUserQuery) {
    this.assertInternal(actor);
    this.assertContextContract(input);
    const action = PURPOSE_ACTION[input.purpose];
    const scope = this.authorization.assertAllowed({
      actor,
      action,
      resourceType: "eligible_user",
    }).repositoryScope!;
    const contextInput = Object.fromEntries(
      CONTEXT_KEYS.flatMap((key) => input[key] === undefined ? [] : [[key, input[key]]]),
    ) as EligibilityContext;
    const context = Object.keys(contextInput).length === 0
      ? {}
      : await this.repository.resolveContext(scope, contextInput);
    if (context === null) throw this.notFound();
    return { items: await this.repository.listEligible(input.purpose, context, input.search) };
  }

  private assertContextContract(input: EligibleUserQuery): void {
    const present = CONTEXT_KEYS.filter((key) => input[key] !== undefined);
    const exact = (...allowed: (typeof CONTEXT_KEYS)[number][]) =>
      present.length === allowed.length && present.every((key) => allowed.includes(key));
    const valid = input.purpose === "organization_account_manager"
      ? (present.length === 0 || exact("organizationId"))
      : input.purpose === "project_lead"
        ? (exact("organizationId") || exact("projectId"))
        : input.purpose === "project_member"
          ? exact("projectId")
          : input.purpose === "task_assignee"
            ? (present.length === 0 || exact("projectId") || exact("taskId"))
            : input.purpose === "ticket_assignee"
              ? exact("ticketId")
              : exact("leadId");
    if (!valid) {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "The supplied context is incompatible with the eligibility purpose",
        statusCode: 400,
      });
    }
  }

  private assertInternal(actor: ActorContext): void {
    if (actor.internal) return;
    throw new AppError({ code: ErrorCode.Forbidden, message: "Operation is not allowed", statusCode: 403 });
  }

  private assertManager(actor: ActorContext, userId: string): void {
    this.assertInternal(actor);
    this.authorization.assertAllowed({
      actor, action: "users.manage", resourceType: "user", resourceId: userId,
    });
  }

  private resolveStatusMutation(result: Awaited<ReturnType<UserCatalogRepository["activate"]>>) {
    if (result.kind === "changed" || result.kind === "unchanged") return result;
    if (result.kind === "not_found") throw this.notFound();
    if (result.kind === "last_administrator") throw this.lastAdministrator();
    throw this.stateConflict(result.kind === "deleted"
      ? "Deleted users cannot be administratively restored"
      : "The requested status transition is not allowed");
  }

  private resolveRoleMutation(result: Awaited<ReturnType<UserCatalogRepository["grantRole"]>>) {
    if (result.kind === "changed" || result.kind === "unchanged") return result;
    if (result.kind === "not_found") throw this.notFound();
    if (result.kind === "last_administrator") throw this.lastAdministrator();
    if (result.kind === "role_not_assignable") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "The requested internal role is not assignable",
        statusCode: 400,
      });
    }
    if (result.kind === "last_internal_role") {
      throw this.stateConflict("An internal collaborator must retain at least one internal role; block access instead");
    }
    throw this.stateConflict(result.kind === "protected_role"
      ? "super_admin changes are outside Personal"
      : "Deleted users cannot be administratively changed");
  }

  private lastAdministrator(): AppError {
    return new AppError({
      code: ErrorCode.LastAdministratorProtected,
      message: "ILVOX must retain at least one active administrator with users.manage",
      statusCode: 409,
      details: { reason: "last_administrator" },
    });
  }

  private stateConflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }

  private notFound(): AppError {
    return new AppError({ code: ErrorCode.NotFound, message: "Resource not found", statusCode: 404 });
  }
}
