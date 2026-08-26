import type { Pool, PoolClient, QueryResultRow } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type {
  DeliverableCreate,
  DeliverablePatch,
  DeliverableRecord,
  MilestoneCreate,
  MilestonePatch,
  MilestoneRecord,
  ProjectCreateInput,
  ProjectListInput,
  ProjectMemberRecord,
  ProjectPatch,
  ProjectRecord,
  ProjectRepository,
  ProjectRoleCode,
  ProjectWriteResult,
} from "./project.types.js";

interface ProjectRow extends QueryResultRow {
  readonly id: string;
  readonly organization_id: string;
  readonly service_id: string | null;
  readonly service_name: string | null;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectRecord["status"];
  readonly priority: ProjectRecord["priority"];
  readonly lead_user_id: string;
  readonly lead_user_name: string | null;
  readonly start_date: string;
  readonly due_date: string;
  readonly created_by_user_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface MemberRow extends QueryResultRow {
  readonly project_id: string;
  readonly organization_id: string;
  readonly user_id: string;
  readonly display_name: string | null;
  readonly role_code: ProjectRoleCode;
  readonly assigned_by_user_id: string | null;
  readonly status: ProjectMemberRecord["status"];
  readonly revoked_at: Date | null;
  readonly revoked_by_user_id: string | null;
  readonly joined_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface MilestoneRow extends QueryResultRow {
  readonly id: string;
  readonly project_id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: MilestoneRecord["status"];
  readonly due_date: string;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface DeliverableRow extends QueryResultRow {
  readonly id: string;
  readonly project_id: string;
  readonly organization_id: string;
  readonly milestone_id: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly status: DeliverableRecord["status"];
  readonly approved_by_user_id: string | null;
  readonly approved_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const PROJECT_SELECT = `SELECT p.id, p.organization_id, p.service_id, s.name AS service_name,
  p.name, p.description, p.status, p.priority, p.lead_user_id,
  nullif(concat_ws(' ', lead.first_name, lead.last_name), '') AS lead_user_name,
  p.start_date::text, p.due_date::text, p.created_by_user_id, p.created_at, p.updated_at
  FROM projects p
  LEFT JOIN services s ON s.id = p.service_id
  JOIN app_users lead ON lead.id = p.lead_user_id`;

const MEMBER_SELECT = `SELECT pm.project_id, pm.organization_id, pm.user_id,
  nullif(concat_ws(' ', u.first_name, u.last_name), '') AS display_name,
  r.code AS role_code, pm.assigned_by_user_id, pm.status, pm.revoked_at,
  pm.revoked_by_user_id, pm.joined_at, pm.created_at, pm.updated_at
  FROM project_members pm
  JOIN app_users u ON u.id = pm.user_id
  JOIN roles r ON r.id = pm.role_id AND r.scope = 'project'`;

const MILESTONE_SELECT = `SELECT m.id, m.project_id, m.organization_id, m.name, m.description,
  m.status, m.due_date::text, m.completed_at, m.created_at, m.updated_at
  FROM project_milestones m`;

const DELIVERABLE_SELECT = `SELECT d.id, d.project_id, d.organization_id, d.milestone_id,
  d.name, d.description,
  d.status, d.approved_by_user_id, d.approved_at, d.created_at, d.updated_at
  FROM deliverables d`;

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    name: row.name,
    description: row.description,
    status: row.status,
    priority: row.priority,
    leadUserId: row.lead_user_id,
    leadUserName: row.lead_user_name,
    startDate: row.start_date,
    dueDate: row.due_date,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): ProjectMemberRecord {
  return {
    projectId: row.project_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    displayName: row.display_name,
    roleCode: row.role_code,
    assignedByUserId: row.assigned_by_user_id,
    status: row.status,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMilestone(row: MilestoneRow): MilestoneRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    status: row.status,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeliverable(row: DeliverableRow): DeliverableRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    milestoneId: row.milestone_id,
    name: row.name,
    description: row.description,
    status: row.status,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectScope(
  scope: AuthorizedRepositoryScope,
  alias = "p",
  startAt = 1,
): { readonly sql: string; readonly values: readonly unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "organization") {
    if (scope.organizationIds.length === 0) return { sql: "false", values: [] };
    return {
      sql: `${alias}.organization_id = ANY($${startAt}::uuid[])`,
      values: [[...scope.organizationIds]],
    };
  }
  if (scope.kind === "assigned") {
    if (scope.organizationIds.length === 0) return { sql: "false", values: [] };
    return {
      sql: `${alias}.organization_id = ANY($${startAt}::uuid[])
        AND EXISTS (
          SELECT 1 FROM project_members scoped_pm
          WHERE scoped_pm.project_id = ${alias}.id AND scoped_pm.user_id = $${startAt + 1}
            AND scoped_pm.status = 'active'
        )`,
      values: [[...scope.organizationIds], scope.actorId],
    };
  }
  return { sql: "false", values: [] };
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  async listAuthorized(scope: AuthorizedRepositoryScope, input: ProjectListInput) {
    const scoped = projectScope(scope);
    const clauses = [scoped.sql];
    const values: unknown[] = [...scoped.values];
    const add = (clause: string, value: unknown): void => {
      values.push(value);
      clauses.push(clause.replaceAll("?", `$${values.length}`));
    };
    if (input.search !== undefined) {
      add("(p.name ILIKE '%' || ? || '%' OR p.description ILIKE '%' || ? || '%')", input.search);
    }
    if (input.status !== undefined) add("p.status = ?", input.status);
    if (input.organizationId !== undefined) add("p.organization_id = ?", input.organizationId);
    if (input.leadUserId !== undefined) add("p.lead_user_id = ?", input.leadUserId);
    if (input.startFrom !== undefined) add("p.start_date >= ?::date", input.startFrom);
    if (input.dueTo !== undefined) add("p.due_date <= ?::date", input.dueTo);
    const where = clauses.join(" AND ");
    const count = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM projects p WHERE ${where}`,
      values,
    );
    const sortColumns = {
      createdAt: "p.created_at",
      updatedAt: "p.updated_at",
      name: "p.name",
      startDate: "p.start_date",
      dueDate: "p.due_date",
    } as const;
    const direction = input.sortDirection === "asc" ? "ASC" : "DESC";
    const rows = await this.pool.query<ProjectRow>(
      `${PROJECT_SELECT} WHERE ${where}
       ORDER BY ${sortColumns[input.sortBy]} ${direction}, p.id ${direction}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.pageSize, paginationOffset(input)],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return { items: rows.rows.map(mapProject), pagination: paginationMeta(input, total) };
  }

  async findAuthorized(scope: AuthorizedRepositoryScope, projectId: string): Promise<ProjectRecord | null> {
    const scoped = projectScope(scope, "p", 2);
    const result = await this.pool.query<ProjectRow>(
      `${PROJECT_SELECT} WHERE p.id = $1 AND ${scoped.sql}`,
      [projectId, ...scoped.values],
    );
    return result.rows[0] === undefined ? null : mapProject(result.rows[0]);
  }

  async getTransitionContext(scope: AuthorizedRepositoryScope, projectId: string) {
    const project = await this.findAuthorized(scope, projectId);
    if (project === null) return null;
    const result = await this.pool.query<{
      readonly incomplete_milestones: number;
      readonly unapproved_deliverables: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM project_milestones
          WHERE project_id = $1 AND status <> 'completed') AS incomplete_milestones,
         (SELECT count(*)::int FROM deliverables
          WHERE project_id = $1 AND status <> 'approved') AS unapproved_deliverables`,
      [projectId],
    );
    return {
      project,
      incompleteMilestones: result.rows[0]!.incomplete_milestones,
      unapprovedDeliverables: result.rows[0]!.unapproved_deliverables,
    };
  }

  create(
    scope: AuthorizedRepositoryScope,
    input: ProjectCreateInput,
    createdByUserId: string,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>> {
    return transaction(this.pool, async (client) => {
      if (!this.organizationInScope(scope, input.organizationId)) return "not_found";
      const organization = await client.query(
        "SELECT 1 FROM organizations WHERE id = $1 AND status = 'active' FOR SHARE",
        [input.organizationId],
      );
      if (organization.rowCount === 0) return "not_found";
      if (!await this.validInternalUser(client, input.leadUserId)) return "ineligible_user";
      if (!await this.validService(client, input.serviceId)) return "invalid_service";
      if (input.dueDate < input.startDate) return "invalid_dates";
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO projects (
           organization_id, service_id, name, description, status, priority,
           lead_user_id, start_date, due_date, created_by_user_id
         ) VALUES ($1,$2,$3,$4,'planning',$5,$6,$7::date,$8::date,$9)
         RETURNING id`,
        [
          input.organizationId,
          input.serviceId ?? null,
          input.name.trim(),
          input.description,
          input.priority ?? "medium",
          input.leadUserId,
          input.startDate,
          input.dueDate,
          createdByUserId,
        ],
      );
      const projectId = inserted.rows[0]!.id;
      await insertAuditEvent(client, {
        ...audit,
        organizationId: input.organizationId,
        action: "project.created",
        entityType: "project",
        entityId: projectId,
        newValues: {
          organizationId: input.organizationId,
          serviceId: input.serviceId ?? null,
          status: "planning",
          priority: input.priority ?? "medium",
          leadUserId: input.leadUserId,
          startDate: input.startDate,
          dueDate: input.dueDate,
        },
      });
      return (await this.selectProject(client, projectId))!;
    });
  }

  update(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    input: ProjectPatch,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await this.lockProject(client, scope, projectId);
      if (current === null) return "not_found";
      if (input.expectedUpdatedAt !== undefined &&
          input.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      if (!await this.validService(client, input.serviceId)) return "invalid_service";
      const startDate = input.startDate ?? current.startDate;
      const dueDate = input.dueDate ?? current.dueDate;
      if (dueDate < startDate) return "invalid_dates";
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown, cast = ""): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}${cast}`);
      };
      if (input.serviceId !== undefined) set("service_id", input.serviceId);
      if (input.name !== undefined) set("name", input.name.trim());
      if (input.description !== undefined) set("description", input.description);
      if (input.priority !== undefined) set("priority", input.priority);
      if (input.startDate !== undefined) set("start_date", input.startDate, "::date");
      if (input.dueDate !== undefined) set("due_date", input.dueDate, "::date");
      if (fields.length === 0) return current;
      values.push(projectId);
      await client.query(
        `UPDATE projects SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined),
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: current.organizationId,
        action: "project.updated",
        entityType: "project",
        entityId: projectId,
        oldValues: Object.fromEntries(Object.keys(changed).map((key) => [key, current[key as keyof ProjectRecord]])),
        newValues: changed,
      });
      return (await this.selectProject(client, projectId))!;
    });
  }

  assignLead(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    leadUserId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await this.lockProject(client, scope, projectId);
      if (current === null) return "not_found";
      if (expectedUpdatedAt !== undefined &&
          expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      if (!await this.validInternalUser(client, leadUserId)) return "ineligible_user";
      await client.query(
        "UPDATE projects SET lead_user_id = $1, updated_at = now() WHERE id = $2",
        [leadUserId, projectId],
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: current.organizationId,
        action: "project.lead_assigned",
        entityType: "project",
        entityId: projectId,
        oldValues: { leadUserId: current.leadUserId },
        newValues: { leadUserId },
      });
      return (await this.selectProject(client, projectId))!;
    });
  }

  transition(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    currentStatus: ProjectRecord["status"],
    nextStatus: ProjectRecord["status"],
    reason: string | undefined,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await this.lockProject(client, scope, projectId);
      if (current === null) return "not_found";
      if (current.status !== currentStatus) return "conflict";
      if (nextStatus === "delivered") {
        const pending = await client.query<{
          readonly incomplete_milestones: number;
          readonly unapproved_deliverables: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM project_milestones
              WHERE project_id = $1 AND status <> 'completed') AS incomplete_milestones,
             (SELECT count(*)::int FROM deliverables
              WHERE project_id = $1 AND status <> 'approved') AS unapproved_deliverables`,
          [projectId],
        );
        const row = pending.rows[0]!;
        if (row.incomplete_milestones > 0 || row.unapproved_deliverables > 0) return "conflict";
      }
      await client.query(
        "UPDATE projects SET status = $1, updated_at = now() WHERE id = $2",
        [nextStatus, projectId],
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: current.organizationId,
        action: "project.status_transitioned",
        entityType: "project",
        entityId: projectId,
        oldValues: { status: currentStatus },
        newValues: {
          status: nextStatus,
          ...(reason === undefined ? {} : { reason: reason.trim().slice(0, 500) }),
        },
      });
      return (await this.selectProject(client, projectId))!;
    });
  }

  async listMembers(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<readonly ProjectMemberRecord[] | null> {
    const project = await this.findAuthorized(scope, projectId);
    if (project === null) return null;
    const result = await this.pool.query<MemberRow>(
      `${MEMBER_SELECT}
       WHERE pm.project_id = $1 AND pm.status = 'active'
       ORDER BY pm.joined_at, pm.user_id`,
      [projectId],
    );
    return result.rows.map(mapMember);
  }

  createMember(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    userId: string,
    roleCode: ProjectRoleCode,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectMemberRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      if (!await this.validProjectMemberUser(client, project.organizationId, userId)) {
        return "ineligible_user";
      }
      try {
        await client.query(
          `INSERT INTO project_members (
             project_id, organization_id, user_id, role_id, role_scope, assigned_by_user_id
           )
           SELECT $1, $2, $3, r.id, 'project', $4
           FROM roles r WHERE r.scope = 'project' AND r.code = $5`,
          [projectId, project.organizationId, userId, audit.actorUserId ?? null, roleCode],
        );
      } catch (error) {
        if (isUniqueViolation(error)) return "conflict";
        throw error;
      }
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: "project_member.created",
        entityType: "project_member",
        entityId: projectId,
        newValues: { userId, roleCode },
      });
      return (await this.selectMember(client, projectId, userId))!;
    });
  }

  updateMember(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    userId: string,
    roleCode: ProjectRoleCode,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectMemberRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      const current = await this.selectMember(client, projectId, userId, true, true);
      if (current === null) return "not_found";
      if (expectedUpdatedAt !== undefined &&
          expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      await client.query(
        `UPDATE project_members pm
         SET role_id = r.id, updated_at = now()
         FROM roles r
         WHERE pm.project_id = $1 AND pm.user_id = $2
           AND pm.status = 'active'
           AND r.scope = 'project' AND r.code = $3`,
        [projectId, userId, roleCode],
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: "project_member.role_updated",
        entityType: "project_member",
        entityId: projectId,
        oldValues: { userId, roleCode: current.roleCode },
        newValues: { userId, roleCode },
      });
      return (await this.selectMember(client, projectId, userId))!;
    });
  }

  revokeMember(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    userId: string,
    expectedUpdatedAt: Date | undefined,
    revokedByUserId: string,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectMemberRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      const current = await this.selectMember(client, projectId, userId, true);
      if (current === null) return "not_found";
      if (current.status === "revoked") return current;
      if (expectedUpdatedAt !== undefined &&
          expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      await client.query(
        `UPDATE project_members
         SET status = 'revoked', revoked_at = now(), revoked_by_user_id = $1, updated_at = now()
         WHERE project_id = $2 AND user_id = $3 AND status = 'active'`,
        [revokedByUserId, projectId, userId],
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: "project_member.revoked",
        entityType: "project_member",
        entityId: projectId,
        oldValues: { userId, status: "active", roleCode: current.roleCode },
        newValues: { userId, status: "revoked", revokedByUserId },
      });
      return (await this.selectMember(client, projectId, userId))!;
    });
  }

  async listMilestones(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<readonly MilestoneRecord[] | null> {
    if (await this.findAuthorized(scope, projectId) === null) return null;
    const result = await this.pool.query<MilestoneRow>(
      `${MILESTONE_SELECT} WHERE m.project_id = $1 ORDER BY m.due_date, m.id`,
      [projectId],
    );
    return result.rows.map(mapMilestone);
  }

  async findMilestone(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    milestoneId: string,
  ): Promise<MilestoneRecord | null> {
    if (await this.findAuthorized(scope, projectId) === null) return null;
    const result = await this.pool.query<MilestoneRow>(
      `${MILESTONE_SELECT} WHERE m.project_id = $1 AND m.id = $2`,
      [projectId, milestoneId],
    );
    return result.rows[0] === undefined ? null : mapMilestone(result.rows[0]);
  }

  createMilestone(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    input: MilestoneCreate,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<MilestoneRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      if (project.status === "delivered" || project.status === "cancelled") return "conflict";
      if (input.dueDate < project.startDate || input.dueDate > project.dueDate) return "invalid_dates";
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO project_milestones (
           project_id, organization_id, name, description, status, due_date
         ) VALUES ($1,$2,$3,$4,'pending',$5::date) RETURNING id`,
        [projectId, project.organizationId, input.name.trim(), input.description ?? null, input.dueDate],
      );
      const id = inserted.rows[0]!.id;
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: "project_milestone.created",
        entityType: "project_milestone",
        entityId: id,
        newValues: { projectId, status: "pending", dueDate: input.dueDate },
      });
      return (await this.selectMilestone(client, projectId, id))!;
    });
  }

  updateMilestone(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    milestoneId: string,
    input: MilestonePatch,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<MilestoneRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      if (project.status === "delivered" || project.status === "cancelled") return "conflict";
      const current = await this.selectMilestone(client, projectId, milestoneId, true);
      if (current === null) return "not_found";
      if (input.expectedUpdatedAt !== undefined &&
          input.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      if (input.dueDate !== undefined &&
          (input.dueDate < project.startDate || input.dueDate > project.dueDate)) return "invalid_dates";
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown, cast = ""): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}${cast}`);
      };
      if (input.name !== undefined) set("name", input.name.trim());
      if (input.description !== undefined) set("description", input.description);
      if (input.dueDate !== undefined) set("due_date", input.dueDate, "::date");
      if (input.status !== undefined) {
        set("status", input.status);
        fields.push(input.status === "completed" ? "completed_at = now()" : "completed_at = NULL");
      }
      if (fields.length === 0) return current;
      values.push(milestoneId);
      await client.query(
        `UPDATE project_milestones SET ${fields.join(", ")}, updated_at = now()
         WHERE id = $${values.length}`,
        values,
      );
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined),
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: input.status === undefined
          ? "project_milestone.updated"
          : "project_milestone.status_changed",
        entityType: "project_milestone",
        entityId: milestoneId,
        ...(input.status === undefined ? {} : { oldValues: { status: current.status } }),
        newValues: changed,
      });
      return (await this.selectMilestone(client, projectId, milestoneId))!;
    });
  }

  async listDeliverables(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<readonly DeliverableRecord[] | null> {
    if (await this.findAuthorized(scope, projectId) === null) return null;
    const result = await this.pool.query<DeliverableRow>(
      `${DELIVERABLE_SELECT} WHERE d.project_id = $1 ORDER BY d.created_at, d.id`,
      [projectId],
    );
    return result.rows.map(mapDeliverable);
  }

  async findDeliverable(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    deliverableId: string,
  ): Promise<DeliverableRecord | null> {
    if (await this.findAuthorized(scope, projectId) === null) return null;
    const result = await this.pool.query<DeliverableRow>(
      `${DELIVERABLE_SELECT} WHERE d.project_id = $1 AND d.id = $2`,
      [projectId, deliverableId],
    );
    return result.rows[0] === undefined ? null : mapDeliverable(result.rows[0]);
  }

  createDeliverable(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    input: DeliverableCreate,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<DeliverableRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      if (project.status === "delivered" || project.status === "cancelled") return "conflict";
      if (input.milestoneId !== undefined &&
          await this.selectMilestone(client, projectId, input.milestoneId, true) === null) {
        return "not_found";
      }
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO deliverables (
           project_id, organization_id, milestone_id, name, description, status
         ) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
        [
          projectId,
          project.organizationId,
          input.milestoneId ?? null,
          input.name.trim(),
          input.description ?? null,
        ],
      );
      const id = inserted.rows[0]!.id;
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: "deliverable.created",
        entityType: "deliverable",
        entityId: id,
        newValues: { projectId, milestoneId: input.milestoneId ?? null, status: "pending" },
      });
      return (await this.selectDeliverable(client, projectId, id))!;
    });
  }

  updateDeliverable(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    deliverableId: string,
    input: DeliverablePatch,
    actorUserId: string,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<DeliverableRecord>> {
    return transaction(this.pool, async (client) => {
      const project = await this.lockProject(client, scope, projectId);
      if (project === null) return "not_found";
      if (project.status === "delivered" || project.status === "cancelled") return "conflict";
      const current = await this.selectDeliverable(client, projectId, deliverableId, true);
      if (current === null) return "not_found";
      if (input.expectedUpdatedAt !== undefined &&
          input.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) return "conflict";
      if (input.milestoneId !== undefined && input.milestoneId !== null &&
          await this.selectMilestone(client, projectId, input.milestoneId, true) === null) {
        return "not_found";
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };
      if (input.name !== undefined) set("name", input.name.trim());
      if (input.description !== undefined) set("description", input.description);
      if (input.milestoneId !== undefined) set("milestone_id", input.milestoneId);
      if (input.status !== undefined) {
        set("status", input.status);
        if (input.status === "approved") {
          set("approved_by_user_id", actorUserId);
          fields.push("approved_at = now()");
        } else {
          fields.push("approved_by_user_id = NULL", "approved_at = NULL");
        }
      }
      if (fields.length === 0) return current;
      values.push(deliverableId);
      await client.query(
        `UPDATE deliverables SET ${fields.join(", ")}, updated_at = now()
         WHERE id = $${values.length}`,
        values,
      );
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined),
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId: project.organizationId,
        action: input.status === undefined ? "deliverable.updated" : "deliverable.status_changed",
        entityType: "deliverable",
        entityId: deliverableId,
        ...(input.status === undefined ? {} : { oldValues: { status: current.status } }),
        newValues: changed,
      });
      return (await this.selectDeliverable(client, projectId, deliverableId))!;
    });
  }

  private organizationInScope(scope: AuthorizedRepositoryScope, organizationId: string): boolean {
    return scope.kind === "global" ||
      (scope.kind !== "public" && scope.organizationIds.includes(organizationId));
  }

  private async validInternalUser(client: PoolClient, userId: string): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM app_users u
       WHERE u.id = $1 AND u.status = 'active'
         AND EXISTS (
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id AND p.code = 'projects.manage'
           WHERE ur.user_id = u.id AND r.scope = 'global'
         )`,
      [userId],
    );
    return result.rowCount !== 0;
  }

  private async validProjectMemberUser(
    client: PoolClient,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM app_users u
       WHERE u.id = $1 AND u.status = 'active'
         AND (
           EXISTS (
             SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
             JOIN role_permissions rp ON rp.role_id = r.id
             JOIN permissions p ON p.id = rp.permission_id AND p.code = 'projects.read'
             WHERE ur.user_id = u.id AND r.scope = 'global'
           )
           OR EXISTS (
             SELECT 1 FROM organization_memberships om
             JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
             WHERE om.user_id = u.id AND om.organization_id = $2 AND om.status = 'active'
           )
         )`,
      [userId, organizationId],
    );
    return result.rowCount !== 0;
  }

  private async validService(client: PoolClient, serviceId: string | null | undefined): Promise<boolean> {
    if (serviceId === undefined || serviceId === null) return true;
    const result = await client.query("SELECT 1 FROM services WHERE id = $1", [serviceId]);
    return result.rowCount !== 0;
  }

  private async selectProject(client: PoolClient, projectId: string): Promise<ProjectRecord | null> {
    const result = await client.query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
    return result.rows[0] === undefined ? null : mapProject(result.rows[0]);
  }

  private async lockProject(
    client: PoolClient,
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<ProjectRecord | null> {
    const scoped = projectScope(scope, "p", 2);
    const locked = await client.query<ProjectRow>(
      `SELECT p.id, p.organization_id, p.service_id, NULL::text AS service_name,
         p.name, p.description, p.status, p.priority, p.lead_user_id,
         NULL::text AS lead_user_name, p.start_date::text, p.due_date::text,
         p.created_by_user_id, p.created_at, p.updated_at
       FROM projects p WHERE p.id = $1 AND ${scoped.sql} FOR UPDATE OF p`,
      [projectId, ...scoped.values],
    );
    return locked.rows[0] === undefined ? null : mapProject(locked.rows[0]);
  }

  private async selectMember(
    client: PoolClient,
    projectId: string,
    userId: string,
    lock = false,
    activeOnly = false,
  ): Promise<ProjectMemberRecord | null> {
    const result = await client.query<MemberRow>(
      `${MEMBER_SELECT}
       WHERE pm.project_id = $1 AND pm.user_id = $2
       ${activeOnly ? "AND pm.status = 'active'" : ""}
       ${lock ? "FOR UPDATE OF pm" : ""}`,
      [projectId, userId],
    );
    return result.rows[0] === undefined ? null : mapMember(result.rows[0]);
  }

  private async selectMilestone(
    client: PoolClient,
    projectId: string,
    milestoneId: string,
    lock = false,
  ): Promise<MilestoneRecord | null> {
    const result = await client.query<MilestoneRow>(
      `${MILESTONE_SELECT} WHERE m.project_id = $1 AND m.id = $2${lock ? " FOR UPDATE OF m" : ""}`,
      [projectId, milestoneId],
    );
    return result.rows[0] === undefined ? null : mapMilestone(result.rows[0]);
  }

  private async selectDeliverable(
    client: PoolClient,
    projectId: string,
    deliverableId: string,
    lock = false,
  ): Promise<DeliverableRecord | null> {
    const result = await client.query<DeliverableRow>(
      `${DELIVERABLE_SELECT} WHERE d.project_id = $1 AND d.id = $2${lock ? " FOR UPDATE OF d" : ""}`,
      [projectId, deliverableId],
    );
    return result.rows[0] === undefined ? null : mapDeliverable(result.rows[0]);
  }
}
