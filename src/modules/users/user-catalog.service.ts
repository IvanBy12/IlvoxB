import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
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

  private notFound(): AppError {
    return new AppError({ code: ErrorCode.NotFound, message: "Resource not found", statusCode: 404 });
  }
}
