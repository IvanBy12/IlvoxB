import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { TaskStatus } from "../../common/state-machines/task-transitions.js";
import type { ProjectPriority } from "../projects/project.types.js";

export interface TaskRecord {
  readonly id: string;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string;
  readonly assignedToUserId: string;
  readonly assignedToName: string | null;
  readonly createdByUserId: string;
  readonly priority: ProjectPriority;
  readonly status: TaskStatus;
  readonly dueDate: string;
  readonly estimatedMinutes: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TaskCreateInput {
  readonly projectId?: string;
  readonly title: string;
  readonly description: string;
  readonly assignedToUserId: string;
  readonly priority?: ProjectPriority;
  readonly dueDate: string;
  readonly estimatedMinutes?: number;
}

export interface TaskPatch {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: ProjectPriority;
  readonly dueDate?: string;
  readonly estimatedMinutes?: number | null;
  readonly expectedUpdatedAt?: Date;
}

export interface TaskListInput extends PaginationInput {
  readonly search?: string;
  readonly status?: TaskStatus;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly assignedToUserId?: string;
  readonly createdByUserId?: string;
  readonly dueFrom?: string;
  readonly dueTo?: string;
  readonly sortBy: "createdAt" | "updatedAt" | "title" | "dueDate";
  readonly sortDirection: "asc" | "desc";
}

export type TaskWriteResult<T> =
  | T
  | "not_found"
  | "conflict"
  | "ineligible_user"
  | "invalid_dates"
  | "project_closed";

export interface TaskRepository {
  listAuthorized(
    scope: AuthorizedRepositoryScope,
    input: TaskListInput,
  ): Promise<PaginatedResult<TaskRecord>>;
  findAuthorized(scope: AuthorizedRepositoryScope, taskId: string): Promise<TaskRecord | null>;
  create(
    scope: AuthorizedRepositoryScope,
    input: TaskCreateInput,
    createdByUserId: string,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>>;
  update(
    scope: AuthorizedRepositoryScope,
    taskId: string,
    input: TaskPatch,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>>;
  assign(
    scope: AuthorizedRepositoryScope,
    taskId: string,
    assignedToUserId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>>;
  transition(
    scope: AuthorizedRepositoryScope,
    taskId: string,
    currentStatus: TaskStatus,
    nextStatus: TaskStatus,
    reason: string | undefined,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>>;
}
