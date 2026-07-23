import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { canTransitionTask, type TaskStatus } from "../../common/state-machines/task-transitions.js";
import type {
  TaskCreateInput,
  TaskListInput,
  TaskPatch,
  TaskRepository,
  TaskWriteResult,
} from "./task.types.js";

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  list(actor: ActorContext, input: TaskListInput) {
    return this.repository.listAuthorized(this.scope(actor, "tasks.read"), input);
  }

  async get(actor: ActorContext, taskId: string) {
    const task = await this.repository.findAuthorized(this.scope(actor, "tasks.read"), taskId);
    if (task === null) throw this.notFound();
    return task;
  }

  create(actor: ActorContext, input: TaskCreateInput, audit: AuditContext) {
    const scope = input.projectId === undefined
      ? this.standaloneScope(actor)
      : this.scope(actor, "tasks.manage");
    return this.unwrap(this.repository.create(scope, input, actor.localUserId, audit));
  }

  update(actor: ActorContext, taskId: string, input: TaskPatch, audit: AuditContext) {
    return this.unwrap(this.repository.update(
      this.scope(actor, "tasks.manage"),
      taskId,
      input,
      audit,
    ));
  }

  assign(
    actor: ActorContext,
    taskId: string,
    assignedToUserId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.assign(
      this.scope(actor, "tasks.manage"),
      taskId,
      assignedToUserId,
      expectedUpdatedAt,
      audit,
    ));
  }

  async transition(
    actor: ActorContext,
    taskId: string,
    nextStatus: TaskStatus,
    reason: string | undefined,
    audit: AuditContext,
  ) {
    const scope = this.scope(actor, "tasks.manage");
    const task = await this.repository.findAuthorized(scope, taskId);
    if (task === null) throw this.notFound();
    const decision = canTransitionTask({
      actor,
      task,
      currentStatus: task.status,
      nextStatus,
      ...(reason === undefined ? {} : { reason }),
    });
    if (!decision.allowed) throw this.conflict(`Task transition rejected: ${decision.reason}`);
    return this.unwrap(this.repository.transition(
      scope,
      taskId,
      task.status,
      nextStatus,
      reason,
      audit,
    ));
  }

  private scope(
    actor: ActorContext,
    action: "tasks.read" | "tasks.manage",
  ): AuthorizedRepositoryScope {
    return this.authorization.assertAllowed({
      actor,
      action,
      resourceType: "task",
    }).repositoryScope!;
  }

  private standaloneScope(actor: ActorContext): AuthorizedRepositoryScope {
    if (!actor.internal) {
      throw new AppError({
        code: ErrorCode.Forbidden,
        message: "Standalone tasks are restricted to internal actors",
        statusCode: 403,
      });
    }
    return this.authorization.assertAllowed({
      actor,
      action: "tasks.manage",
      requestedScope: "global",
      resourceType: "task",
    }).repositoryScope!;
  }

  private async unwrap<T>(promise: Promise<TaskWriteResult<T>>): Promise<T> {
    const result = await promise;
    if (result === "not_found") throw this.notFound();
    if (result === "conflict") throw this.conflict("Resource state changed concurrently");
    if (result === "project_closed") throw this.conflict("The project does not accept task changes");
    if (result === "ineligible_user") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "The selected assignee is not active or eligible for this task",
        statusCode: 400,
      });
    }
    if (result === "invalid_dates") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Task due date is outside the project range",
        statusCode: 400,
      });
    }
    return result;
  }

  private notFound(): AppError {
    return new AppError({ code: ErrorCode.NotFound, message: "Task not found", statusCode: 404 });
  }

  private conflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }
}
