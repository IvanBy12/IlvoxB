import type { Pool, PoolClient, QueryResultRow } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type {
  TaskCreateInput,
  TaskListInput,
  TaskPatch,
  TaskRecord,
  TaskRepository,
  TaskWriteResult,
} from "./task.types.js";

interface TaskRow extends QueryResultRow {
  readonly id: string;
  readonly organization_id: string | null;
  readonly project_id: string | null;
  readonly title: string;
  readonly description: string;
  readonly assigned_to_user_id: string;
  readonly assigned_to_name: string | null;
  readonly created_by_user_id: string;
  readonly priority: TaskRecord["priority"];
  readonly status: TaskRecord["status"];
  readonly due_date: string;
  readonly estimated_minutes: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ProjectContextRow extends QueryResultRow {
  readonly id: string;
  readonly organization_id: string;
  readonly status: string;
  readonly start_date: string;
  readonly due_date: string;
}

const TASK_SELECT = `SELECT t.id, t.organization_id, t.project_id, t.title, t.description,
  t.assigned_to_user_id,
  nullif(concat_ws(' ', assignee.first_name, assignee.last_name), '') AS assigned_to_name,
  t.created_by_user_id, t.priority, t.status, t.due_date::text, t.estimated_minutes,
  t.created_at, t.updated_at
  FROM tasks t
  JOIN app_users assignee ON assignee.id = t.assigned_to_user_id`;

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    createdByUserId: row.created_by_user_id,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date,
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskScope(
  scope: AuthorizedRepositoryScope,
  alias = "t",
  startAt = 1,
): { readonly sql: string; readonly values: readonly unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public") return { sql: "false", values: [] };
  if (scope.kind === "organization") {
    if (scope.organizationIds.length === 0) return { sql: "false", values: [] };
    return {
      sql: `${alias}.organization_id = ANY($${startAt}::uuid[])`,
      values: [[...scope.organizationIds]],
    };
  }
  if (scope.kind === "own") {
    return {
      sql: `${alias}.created_by_user_id = $${startAt}
        AND (
          ${alias}.organization_id IS NULL
          OR ${alias}.organization_id = ANY($${startAt + 1}::uuid[])
        )`,
      values: [scope.actorId, [...scope.organizationIds]],
    };
  }
  return {
    sql: `(
      (${alias}.organization_id IS NULL AND ${alias}.assigned_to_user_id = $${startAt})
      OR (
        ${alias}.organization_id = ANY($${startAt + 1}::uuid[])
        AND ${alias}.project_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM project_members scoped_pm
          WHERE scoped_pm.project_id = ${alias}.project_id
            AND scoped_pm.user_id = $${startAt}
            AND scoped_pm.status = 'active'
        )
      )
    )`,
    values: [scope.actorId, [...scope.organizationIds]],
  };
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly pool: Pool) {}

  async listAuthorized(scope: AuthorizedRepositoryScope, input: TaskListInput) {
    const scoped = taskScope(scope);
    const clauses = [scoped.sql, "t.ticket_id IS NULL"];
    const values: unknown[] = [...scoped.values];
    const add = (clause: string, value: unknown): void => {
      values.push(value);
      clauses.push(clause.replaceAll("?", `$${values.length}`));
    };
    if (input.search !== undefined) {
      add("(t.title ILIKE '%' || ? || '%' OR t.description ILIKE '%' || ? || '%')", input.search);
    }
    if (input.status !== undefined) add("t.status = ?", input.status);
    if (input.organizationId !== undefined) add("t.organization_id = ?", input.organizationId);
    if (input.projectId !== undefined) add("t.project_id = ?", input.projectId);
    if (input.assignedToUserId !== undefined) add("t.assigned_to_user_id = ?", input.assignedToUserId);
    if (input.createdByUserId !== undefined) add("t.created_by_user_id = ?", input.createdByUserId);
    if (input.dueFrom !== undefined) add("t.due_date >= ?::date", input.dueFrom);
    if (input.dueTo !== undefined) add("t.due_date <= ?::date", input.dueTo);
    const where = clauses.join(" AND ");
    const count = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM tasks t WHERE ${where}`,
      values,
    );
    const sortColumns = {
      createdAt: "t.created_at",
      updatedAt: "t.updated_at",
      title: "t.title",
      dueDate: "t.due_date",
    } as const;
    const direction = input.sortDirection === "asc" ? "ASC" : "DESC";
    const rows = await this.pool.query<TaskRow>(
      `${TASK_SELECT} WHERE ${where}
       ORDER BY ${sortColumns[input.sortBy]} ${direction}, t.id ${direction}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.pageSize, paginationOffset(input)],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return { items: rows.rows.map(mapTask), pagination: paginationMeta(input, total) };
  }

  async findAuthorized(scope: AuthorizedRepositoryScope, taskId: string): Promise<TaskRecord | null> {
    const scoped = taskScope(scope, "t", 2);
    const result = await this.pool.query<TaskRow>(
      `${TASK_SELECT} WHERE t.id = $1 AND t.ticket_id IS NULL AND ${scoped.sql}`,
      [taskId, ...scoped.values],
    );
    return result.rows[0] === undefined ? null : mapTask(result.rows[0]);
  }

  create(
    scope: AuthorizedRepositoryScope,
    input: TaskCreateInput,
    createdByUserId: string,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>> {
    return transaction(this.pool, async (client) => {
      let organizationId: string | null = null;
      if (input.projectId !== undefined) {
        const project = await this.lockProject(client, scope, input.projectId);
        if (project === null) return "not_found";
        if (project.status === "delivered" || project.status === "cancelled") return "project_closed";
        if (input.dueDate < project.start_date || input.dueDate > project.due_date) return "invalid_dates";
        if (!await this.validProjectAssignee(client, input.projectId, input.assignedToUserId)) {
          return "ineligible_user";
        }
        organizationId = project.organization_id;
      } else if (!await this.validInternalUser(client, input.assignedToUserId)) {
        return "ineligible_user";
      }
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO tasks (
           organization_id, project_id, ticket_id, title, description,
           assigned_to_user_id, created_by_user_id, priority, status, due_date, estimated_minutes
         ) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,'pending',$8::date,$9) RETURNING id`,
        [
          organizationId,
          input.projectId ?? null,
          input.title.trim(),
          input.description,
          input.assignedToUserId,
          createdByUserId,
          input.priority ?? "medium",
          input.dueDate,
          input.estimatedMinutes ?? null,
        ],
      );
      const taskId = inserted.rows[0]!.id;
      await insertAuditEvent(client, {
        ...audit,
        ...(organizationId === null ? {} : { organizationId }),
        action: "task.created",
        entityType: "task",
        entityId: taskId,
        newValues: {
          projectId: input.projectId ?? null,
          standalone: input.projectId === undefined,
          assignedToUserId: input.assignedToUserId,
          priority: input.priority ?? "medium",
          status: "pending",
          dueDate: input.dueDate,
          estimatedMinutes: input.estimatedMinutes ?? null,
        },
      });
      return (await this.selectTask(client, taskId))!;
    });
  }

  update(
    scope: AuthorizedRepositoryScope,
    taskId: string,
    input: TaskPatch,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await this.lockTask(client, scope, taskId);
      if (current === null) return "not_found";
      if (input.expectedUpdatedAt !== undefined &&
          input.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      if (current.projectId !== null) {
        const project = await this.lockProjectById(client, current.projectId);
        if (project === null) return "not_found";
        if (project.status === "delivered" || project.status === "cancelled") return "project_closed";
        if (input.dueDate !== undefined &&
            (input.dueDate < project.start_date || input.dueDate > project.due_date)) return "invalid_dates";
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown, cast = ""): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}${cast}`);
      };
      if (input.title !== undefined) set("title", input.title.trim());
      if (input.description !== undefined) set("description", input.description);
      if (input.priority !== undefined) set("priority", input.priority);
      if (input.dueDate !== undefined) set("due_date", input.dueDate, "::date");
      if (input.estimatedMinutes !== undefined) set("estimated_minutes", input.estimatedMinutes);
      if (fields.length === 0) return current;
      values.push(taskId);
      await client.query(
        `UPDATE tasks SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined),
      );
      await insertAuditEvent(client, {
        ...audit,
        ...(current.organizationId === null ? {} : { organizationId: current.organizationId }),
        action: "task.updated",
        entityType: "task",
        entityId: taskId,
        newValues: changed,
      });
      return (await this.selectTask(client, taskId))!;
    });
  }

  assign(
    scope: AuthorizedRepositoryScope,
    taskId: string,
    assignedToUserId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await this.lockTask(client, scope, taskId);
      if (current === null) return "not_found";
      if (expectedUpdatedAt !== undefined &&
          expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      if (current.projectId === null) {
        if (!await this.validInternalUser(client, assignedToUserId)) return "ineligible_user";
      } else {
        const project = await this.lockProjectById(client, current.projectId);
        if (project === null) return "not_found";
        if (project.status === "delivered" || project.status === "cancelled") return "project_closed";
        if (!await this.validProjectAssignee(client, current.projectId, assignedToUserId)) {
          return "ineligible_user";
        }
      }
      await client.query(
        "UPDATE tasks SET assigned_to_user_id = $1, updated_at = now() WHERE id = $2",
        [assignedToUserId, taskId],
      );
      await insertAuditEvent(client, {
        ...audit,
        ...(current.organizationId === null ? {} : { organizationId: current.organizationId }),
        action: "task.assigned",
        entityType: "task",
        entityId: taskId,
        oldValues: { assignedToUserId: current.assignedToUserId },
        newValues: { assignedToUserId },
      });
      return (await this.selectTask(client, taskId))!;
    });
  }

  transition(
    scope: AuthorizedRepositoryScope,
    taskId: string,
    currentStatus: TaskRecord["status"],
    nextStatus: TaskRecord["status"],
    reason: string | undefined,
    audit: AuditContext,
  ): Promise<TaskWriteResult<TaskRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await this.lockTask(client, scope, taskId);
      if (current === null) return "not_found";
      if (current.status !== currentStatus) return "conflict";
      if (current.projectId !== null) {
        const project = await this.lockProjectById(client, current.projectId);
        if (project === null) return "not_found";
        if (project.status === "delivered" || project.status === "cancelled") return "project_closed";
      }
      await client.query(
        "UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2",
        [nextStatus, taskId],
      );
      await insertAuditEvent(client, {
        ...audit,
        ...(current.organizationId === null ? {} : { organizationId: current.organizationId }),
        action: "task.status_transitioned",
        entityType: "task",
        entityId: taskId,
        oldValues: { status: currentStatus },
        newValues: {
          status: nextStatus,
          ...(reason === undefined ? {} : { reason: reason.trim().slice(0, 500) }),
        },
      });
      return (await this.selectTask(client, taskId))!;
    });
  }

  private async lockProject(
    client: PoolClient,
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<ProjectContextRow | null> {
    if (scope.kind === "global") return this.lockProjectById(client, projectId);
    if (scope.kind !== "assigned" || scope.organizationIds.length === 0) return null;
    const result = await client.query<ProjectContextRow>(
      `SELECT p.id, p.organization_id, p.status, p.start_date::text, p.due_date::text
       FROM projects p
       WHERE p.id = $1 AND p.organization_id = ANY($2::uuid[])
         AND EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = p.id AND pm.user_id = $3 AND pm.status = 'active'
         )
       FOR UPDATE OF p`,
      [projectId, [...scope.organizationIds], scope.actorId],
    );
    return result.rows[0] ?? null;
  }

  private async lockProjectById(client: PoolClient, projectId: string): Promise<ProjectContextRow | null> {
    const result = await client.query<ProjectContextRow>(
      `SELECT id, organization_id, status, start_date::text, due_date::text
       FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    return result.rows[0] ?? null;
  }

  private async validProjectAssignee(
    client: PoolClient,
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM app_users u
       WHERE u.id = $2 AND u.status = 'active' AND (
         EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = $1 AND pm.user_id = u.id AND pm.status = 'active'
         )
         OR EXISTS (SELECT 1 FROM projects p WHERE p.id = $1 AND p.lead_user_id = u.id)
         OR EXISTS (
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.scope = 'global'
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id AND p.code = 'tasks.manage'
           WHERE ur.user_id = u.id
         )
       )`,
      [projectId, userId],
    );
    return result.rowCount !== 0;
  }

  private async validInternalUser(client: PoolClient, userId: string): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM app_users u
       WHERE u.id = $1 AND u.status = 'active'
         AND EXISTS (
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id AND p.code = 'tasks.manage'
           WHERE ur.user_id = u.id AND r.scope = 'global'
         )`,
      [userId],
    );
    return result.rowCount !== 0;
  }

  private async selectTask(client: PoolClient, taskId: string): Promise<TaskRecord | null> {
    const result = await client.query<TaskRow>(`${TASK_SELECT} WHERE t.id = $1`, [taskId]);
    return result.rows[0] === undefined ? null : mapTask(result.rows[0]);
  }

  private async lockTask(
    client: PoolClient,
    scope: AuthorizedRepositoryScope,
    taskId: string,
  ): Promise<TaskRecord | null> {
    const scoped = taskScope(scope, "t", 2);
    const result = await client.query<TaskRow>(
      `SELECT t.id, t.organization_id, t.project_id, t.title, t.description,
         t.assigned_to_user_id, NULL::text AS assigned_to_name, t.created_by_user_id,
         t.priority, t.status, t.due_date::text, t.estimated_minutes, t.created_at, t.updated_at
       FROM tasks t
       WHERE t.id = $1 AND t.ticket_id IS NULL AND ${scoped.sql}
       FOR UPDATE OF t`,
      [taskId, ...scoped.values],
    );
    return result.rows[0] === undefined ? null : mapTask(result.rows[0]);
  }
}
