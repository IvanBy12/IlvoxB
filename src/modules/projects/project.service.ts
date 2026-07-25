import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { canTransitionProject } from "../../common/state-machines/project-transitions.js";
import type {
  DeliverableCreate,
  DeliverablePatch,
  MilestoneCreate,
  MilestonePatch,
  ProjectCreateInput,
  ProjectListInput,
  ProjectPatch,
  ProjectRepository,
  ProjectRoleCode,
  ProjectWriteResult,
} from "./project.types.js";

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  list(actor: ActorContext, input: ProjectListInput) {
    return this.repository.listAuthorized(this.scope(actor, "projects.read"), input);
  }

  async get(actor: ActorContext, projectId: string) {
    const project = await this.repository.findAuthorized(this.scope(actor, "projects.read"), projectId);
    if (project === null) throw this.notFound();
    return project;
  }

  create(actor: ActorContext, input: ProjectCreateInput, audit: AuditContext) {
    const scope = this.scope(actor, "projects.manage");
    return this.unwrap(this.repository.create(scope, input, actor.localUserId, audit));
  }

  update(actor: ActorContext, projectId: string, input: ProjectPatch, audit: AuditContext) {
    return this.unwrap(this.repository.update(
      this.scope(actor, "projects.manage"),
      projectId,
      input,
      audit,
    ));
  }

  assignLead(
    actor: ActorContext,
    projectId: string,
    leadUserId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.assignLead(
      this.scope(actor, "projects.manage"),
      projectId,
      leadUserId,
      expectedUpdatedAt,
      audit,
    ));
  }

  async transition(
    actor: ActorContext,
    projectId: string,
    nextStatus: Parameters<typeof canTransitionProject>[0]["nextStatus"],
    reason: string | undefined,
    audit: AuditContext,
  ) {
    const scope = this.scope(actor, "projects.manage");
    const context = await this.repository.getTransitionContext(scope, projectId);
    if (context === null) throw this.notFound();
    const { project } = context;
    const decision = canTransitionProject({
      actor,
      project,
      currentStatus: project.status,
      nextStatus,
      incompleteMilestones: context.incompleteMilestones,
      unapprovedDeliverables: context.unapprovedDeliverables,
      ...(reason === undefined ? {} : { reason }),
    });
    if (!decision.allowed) {
      throw this.conflict(`Project transition rejected: ${decision.reason}`);
    }
    return this.unwrap(this.repository.transition(
      scope,
      projectId,
      project.status,
      nextStatus,
      reason,
      audit,
    ));
  }

  async listMembers(actor: ActorContext, projectId: string) {
    const result = await this.repository.listMembers(this.scope(actor, "projects.read"), projectId);
    if (result === null) throw this.notFound();
    return result;
  }

  createMember(
    actor: ActorContext,
    projectId: string,
    userId: string,
    roleCode: ProjectRoleCode,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.createMember(
      this.scope(actor, "projects.manage"),
      projectId,
      userId,
      roleCode,
      audit,
    ));
  }

  updateMember(
    actor: ActorContext,
    projectId: string,
    userId: string,
    roleCode: ProjectRoleCode,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.updateMember(
      this.scope(actor, "projects.manage"),
      projectId,
      userId,
      roleCode,
      expectedUpdatedAt,
      audit,
    ));
  }

  revokeMember(
    actor: ActorContext,
    projectId: string,
    userId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.revokeMember(
      this.scope(actor, "projects.manage"),
      projectId,
      userId,
      expectedUpdatedAt,
      actor.localUserId,
      audit,
    ));
  }

  async listMilestones(actor: ActorContext, projectId: string) {
    const result = await this.repository.listMilestones(this.scope(actor, "projects.read"), projectId);
    if (result === null) throw this.notFound();
    return result;
  }

  async getMilestone(actor: ActorContext, projectId: string, milestoneId: string) {
    const result = await this.repository.findMilestone(
      this.scope(actor, "projects.read"),
      projectId,
      milestoneId,
    );
    if (result === null) throw this.notFound();
    return result;
  }

  createMilestone(
    actor: ActorContext,
    projectId: string,
    input: MilestoneCreate,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.createMilestone(
      this.scope(actor, "projects.manage"),
      projectId,
      input,
      audit,
    ));
  }

  updateMilestone(
    actor: ActorContext,
    projectId: string,
    milestoneId: string,
    input: MilestonePatch,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.updateMilestone(
      this.scope(actor, "projects.manage"),
      projectId,
      milestoneId,
      input,
      audit,
    ));
  }

  async listDeliverables(actor: ActorContext, projectId: string) {
    const result = await this.repository.listDeliverables(
      this.scope(actor, "projects.read"),
      projectId,
    );
    if (result === null) throw this.notFound();
    return result;
  }

  async getDeliverable(actor: ActorContext, projectId: string, deliverableId: string) {
    const result = await this.repository.findDeliverable(
      this.scope(actor, "projects.read"),
      projectId,
      deliverableId,
    );
    if (result === null) throw this.notFound();
    return result;
  }

  createDeliverable(
    actor: ActorContext,
    projectId: string,
    input: DeliverableCreate,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.createDeliverable(
      this.scope(actor, "projects.manage"),
      projectId,
      input,
      audit,
    ));
  }

  updateDeliverable(
    actor: ActorContext,
    projectId: string,
    deliverableId: string,
    input: DeliverablePatch,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.updateDeliverable(
      this.scope(actor, "projects.manage"),
      projectId,
      deliverableId,
      input,
      actor.localUserId,
      audit,
    ));
  }

  private scope(
    actor: ActorContext,
    action: "projects.read" | "projects.manage",
  ): AuthorizedRepositoryScope {
    return this.authorization.assertAllowed({
      actor,
      action,
      resourceType: "project",
    }).repositoryScope!;
  }

  private async unwrap<T>(promise: Promise<ProjectWriteResult<T>>): Promise<T> {
    const result = await promise;
    if (result === "not_found") throw this.notFound();
    if (result === "conflict") throw this.conflict("Resource state changed or operation conflicts");
    if (result === "ineligible_user") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "The selected local user is not active or eligible",
        statusCode: 400,
      });
    }
    if (result === "invalid_service") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "The selected service does not exist",
        statusCode: 400,
      });
    }
    if (result === "invalid_dates") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Dates are outside the allowed project range",
        statusCode: 400,
      });
    }
    return result;
  }

  private notFound(): AppError {
    return new AppError({
      code: ErrorCode.NotFound,
      message: "Project resource not found",
      statusCode: 404,
    });
  }

  private conflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }
}
