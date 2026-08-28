import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type {
  EligibilityContext,
  EligibleUserItem,
  EligibleUserPurpose,
  ResolvedEligibilityContext,
  UserCatalogItem,
  UserCatalogDetail,
  UserCatalogListInput,
  UserCatalogRepository,
} from "./user-catalog.types.js";

interface CatalogRow extends QueryResultRow {
  readonly id: string;
  readonly display_name: string;
  readonly email: string;
  readonly status: UserCatalogItem["status"];
  readonly is_internal: boolean;
  readonly roles: string[];
  readonly internal_roles: string[];
  readonly has_client_access: boolean;
  readonly identity_synchronized: boolean;
  readonly effective_permissions: string[];
  readonly created_at: Date;
}

interface ContextRow extends QueryResultRow {
  readonly organization_id: string | null;
  readonly project_id: string | null;
}

const EFFECTIVE_ROLES_SQL = `
  SELECT r.code
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.scope = 'global'
  WHERE ur.user_id = u.id
  UNION
  SELECT r.code
  FROM organization_memberships om JOIN roles r ON r.id = om.role_id AND r.scope = 'organization'
  JOIN organizations active_o ON active_o.id = om.organization_id AND active_o.status = 'active'
  WHERE om.user_id = u.id AND om.status = 'active'
  UNION
  SELECT r.code
  FROM project_members pm JOIN roles r ON r.id = pm.role_id AND r.scope = 'project'
  WHERE pm.user_id = u.id AND pm.status = 'active'`;

const CATALOG_SQL = `SELECT u.id,
  COALESCE(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.primary_email) AS display_name,
  u.primary_email AS email, u.status,
  EXISTS (
    SELECT 1 FROM user_roles internal_ur JOIN roles internal_r ON internal_r.id = internal_ur.role_id
    WHERE internal_ur.user_id = u.id AND internal_r.scope = 'global'
  ) AS is_internal,
  COALESCE(array_agg(DISTINCT effective_role.code ORDER BY effective_role.code)
    FILTER (WHERE effective_role.code IS NOT NULL), ARRAY[]::varchar[]) AS roles,
  COALESCE((SELECT array_agg(internal_r.code ORDER BY internal_r.code)
    FROM user_roles internal_ur JOIN roles internal_r ON internal_r.id=internal_ur.role_id AND internal_r.scope='global'
    WHERE internal_ur.user_id=u.id), ARRAY[]::varchar[]) AS internal_roles,
  EXISTS (SELECT 1 FROM organization_memberships client_om
    WHERE client_om.user_id=u.id AND client_om.status='active') AS has_client_access,
  u.last_synced_at IS NOT NULL AS identity_synchronized,
  COALESCE((SELECT array_agg(DISTINCT effective_p.code ORDER BY effective_p.code)
    FROM user_roles permission_ur
    JOIN roles permission_r ON permission_r.id=permission_ur.role_id AND permission_r.scope='global'
    JOIN role_permissions permission_rp ON permission_rp.role_id=permission_r.id
    JOIN permissions effective_p ON effective_p.id=permission_rp.permission_id
    WHERE permission_ur.user_id=u.id), ARRAY[]::varchar[]) AS effective_permissions,
  u.created_at
  FROM app_users u
  LEFT JOIN LATERAL (${EFFECTIVE_ROLES_SQL}) effective_role ON true`;

function mapCatalog(row: CatalogRow): UserCatalogItem {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    isInternal: row.is_internal,
    roles: row.roles,
    internalRoles: row.internal_roles,
    hasClientAccess: row.has_client_access,
    createdAt: row.created_at,
    lastAccessAt: null,
  };
}

function mapCatalogDetail(row: CatalogRow): UserCatalogDetail {
  return {
    ...mapCatalog(row),
    identitySynchronized: row.identity_synchronized,
    effectivePermissions: row.effective_permissions,
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
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function findInternalById(client: PoolClient, userId: string, forUpdate = false): Promise<UserCatalogDetail | null> {
  if (forUpdate) {
    const locked = await client.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [userId]);
    if (locked.rowCount === 0) return null;
  }
  const result = await client.query<CatalogRow>(
    `${CATALOG_SQL} WHERE u.id=$1
      AND EXISTS (SELECT 1 FROM user_roles target_ur JOIN roles target_r
        ON target_r.id=target_ur.role_id AND target_r.scope='global' WHERE target_ur.user_id=u.id)
     GROUP BY u.id`,
    [userId],
  );
  return result.rows[0] === undefined ? null : mapCatalogDetail(result.rows[0]);
}

async function hasEffectiveAdminPermission(client: PoolClient, userId: string, excludedRoleId?: string): Promise<boolean> {
  const values: unknown[] = [userId];
  const excluded = excludedRoleId === undefined ? "" : `AND ur.role_id <> $${values.push(excludedRoleId)}`;
  const result = await client.query(
    `SELECT 1 FROM user_roles ur
     JOIN roles r ON r.id=ur.role_id AND r.scope='global'
     JOIN role_permissions rp ON rp.role_id=r.id
     JOIN permissions p ON p.id=rp.permission_id AND p.code='users.manage'
     WHERE ur.user_id=$1 ${excluded} LIMIT 1`,
    values,
  );
  return result.rowCount === 1;
}

async function otherActiveAdministratorExists(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM app_users u
     JOIN user_roles ur ON ur.user_id=u.id
     JOIN roles r ON r.id=ur.role_id AND r.scope='global'
     JOIN role_permissions rp ON rp.role_id=r.id
     JOIN permissions p ON p.id=rp.permission_id AND p.code='users.manage'
     WHERE u.status='active' AND u.id<>$1 LIMIT 1`,
    [userId],
  );
  return result.rowCount === 1;
}

function scopeSql(
  scope: AuthorizedRepositoryScope,
  resource: "organization" | "project" | "task" | "ticket" | "lead",
  startAt: number,
): { readonly sql: string; readonly values: readonly unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public") return { sql: "false", values: [] };
  if (resource === "lead") {
    return scope.kind === "assigned"
      ? { sql: `l.assigned_to_user_id = $${startAt}`, values: [scope.actorId] }
      : { sql: "false", values: [] };
  }
  if (resource === "organization") {
    return scope.organizationIds.length === 0
      ? { sql: "false", values: [] }
      : { sql: `o.id = ANY($${startAt}::uuid[])`, values: [[...scope.organizationIds]] };
  }
  if (resource === "project") {
    if (scope.kind === "organization") {
      return scope.organizationIds.length === 0
        ? { sql: "false", values: [] }
        : { sql: `p.organization_id = ANY($${startAt}::uuid[])`, values: [[...scope.organizationIds]] };
    }
    if (scope.kind === "own") {
      return {
        sql: `p.created_by_user_id = $${startAt} AND p.organization_id = ANY($${startAt + 1}::uuid[])`,
        values: [scope.actorId, [...scope.organizationIds]],
      };
    }
    return {
      sql: `p.organization_id = ANY($${startAt}::uuid[]) AND EXISTS (
        SELECT 1 FROM project_members scoped_pm
        WHERE scoped_pm.project_id = p.id AND scoped_pm.user_id = $${startAt + 1}
          AND scoped_pm.status = 'active')`,
      values: [[...scope.organizationIds], scope.actorId],
    };
  }
  const alias = resource === "task" ? "t" : "tk";
  if (resource === "task") {
    if (scope.kind === "organization") {
      return { sql: `${alias}.organization_id = ANY($${startAt}::uuid[])`, values: [[...scope.organizationIds]] };
    }
    if (scope.kind === "own") {
      return {
        sql: `${alias}.created_by_user_id = $${startAt} AND (
          ${alias}.organization_id IS NULL OR ${alias}.organization_id = ANY($${startAt + 1}::uuid[]))`,
        values: [scope.actorId, [...scope.organizationIds]],
      };
    }
    return {
      sql: `((${alias}.organization_id IS NULL AND ${alias}.assigned_to_user_id = $${startAt}) OR (
        ${alias}.organization_id = ANY($${startAt + 1}::uuid[]) AND ${alias}.project_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM project_members scoped_pm WHERE scoped_pm.project_id = ${alias}.project_id
            AND scoped_pm.user_id = $${startAt} AND scoped_pm.status = 'active')))`,
      values: [scope.actorId, [...scope.organizationIds]],
    };
  }
  if (scope.kind === "own") {
    return { sql: `${alias}.requester_user_id = $${startAt}`, values: [scope.actorId] };
  }
  if (scope.kind === "organization") {
    return {
      sql: `${alias}.organization_id = ANY($${startAt}::uuid[]) AND EXISTS (
        SELECT 1 FROM organization_memberships scoped_om
        WHERE scoped_om.organization_id = ${alias}.organization_id
          AND scoped_om.user_id = $${startAt + 1} AND scoped_om.status = 'active')`,
      values: [[...scope.organizationIds], scope.actorId],
    };
  }
  return {
    sql: `(${alias}.assigned_to_user_id = $${startAt} OR ${alias}.requester_user_id = $${startAt} OR (
      ${alias}.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM project_members scoped_pm WHERE scoped_pm.project_id = ${alias}.project_id
          AND scoped_pm.user_id = $${startAt} AND scoped_pm.status = 'active')))`,
    values: [scope.actorId],
  };
}

function globalPermission(code: string): string {
  return `EXISTS (
    SELECT 1 FROM user_roles eligible_ur
    JOIN roles eligible_r ON eligible_r.id = eligible_ur.role_id AND eligible_r.scope = 'global'
    JOIN role_permissions eligible_rp ON eligible_rp.role_id = eligible_r.id
    JOIN permissions eligible_p ON eligible_p.id = eligible_rp.permission_id AND eligible_p.code = '${code}'
    WHERE eligible_ur.user_id = u.id
  )`;
}

export class PostgresUserCatalogRepository implements UserCatalogRepository {
  constructor(private readonly pool: Pool) {}

  async list(input: UserCatalogListInput) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown): void => {
      values.push(value);
      clauses.push(clause.replaceAll("?", `$${values.length}`));
    };
    if (input.search !== undefined) {
      add(`(u.primary_email ILIKE '%' || ? || '%' OR
        concat_ws(' ', u.first_name, u.last_name) ILIKE '%' || ? || '%')`, input.search);
    }
    if (input.status !== undefined) add("u.status = ?", input.status);
    if (input.type !== undefined) clauses.push(input.type === "internal"
      ? "EXISTS (SELECT 1 FROM user_roles type_ur JOIN roles type_r ON type_r.id = type_ur.role_id WHERE type_ur.user_id = u.id AND type_r.scope = 'global')"
      : "NOT EXISTS (SELECT 1 FROM user_roles type_ur JOIN roles type_r ON type_r.id = type_ur.role_id WHERE type_ur.user_id = u.id AND type_r.scope = 'global')");
    if (input.role !== undefined) {
      add(`EXISTS (SELECT 1 FROM (${EFFECTIVE_ROLES_SQL}) filtered_role WHERE filtered_role.code = ?)`, input.role);
    }
    const where = clauses.length === 0 ? "true" : clauses.join(" AND ");
    const count = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM app_users u WHERE ${where}`,
      values,
    );
    const sortColumns = {
      displayName: "display_name",
      email: "email",
      createdAt: "created_at",
    } as const;
    const direction = input.sortDirection === "asc" ? "ASC" : "DESC";
    const result = await this.pool.query<CatalogRow>(
      `${CATALOG_SQL} WHERE ${where}
       GROUP BY u.id
       ORDER BY ${sortColumns[input.sortBy]} ${direction}, u.id ${direction}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.pageSize, paginationOffset(input)],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const summaryResult = await this.pool.query<{
      readonly active: string; readonly pending: string; readonly blocked: string; readonly deleted: string;
    }>(
      `SELECT
        count(*) FILTER (WHERE u.status='active')::text AS active,
        count(*) FILTER (WHERE u.status='pending')::text AS pending,
        count(*) FILTER (WHERE u.status='blocked')::text AS blocked,
        count(*) FILTER (WHERE u.status='deleted')::text AS deleted
       FROM app_users u WHERE EXISTS (
         SELECT 1 FROM user_roles summary_ur JOIN roles summary_r
           ON summary_r.id=summary_ur.role_id AND summary_r.scope='global'
         WHERE summary_ur.user_id=u.id)`,
    );
    const summary = summaryResult.rows[0];
    return {
      items: result.rows.map(mapCatalog),
      pagination: paginationMeta(input, total),
      summary: {
        active: Number(summary?.active ?? 0), pending: Number(summary?.pending ?? 0),
        blocked: Number(summary?.blocked ?? 0), deleted: Number(summary?.deleted ?? 0),
      },
    };
  }

  async findById(userId: string): Promise<UserCatalogDetail | null> {
    const result = await this.pool.query<CatalogRow>(
      `${CATALOG_SQL} WHERE u.id = $1
       AND EXISTS (SELECT 1 FROM user_roles detail_ur JOIN roles detail_r
         ON detail_r.id=detail_ur.role_id AND detail_r.scope='global' WHERE detail_ur.user_id=u.id)
       GROUP BY u.id`,
      [userId],
    );
    return result.rows[0] === undefined ? null : mapCatalogDetail(result.rows[0]);
  }

  activate(userId: string, actorUserId: string, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox-internal-user-administration'))");
      const current = await findInternalById(client, userId, true);
      if (current === null) return { kind: "not_found" } as const;
      if (current.status === "deleted") return { kind: "deleted" } as const;
      if (current.status === "active") return { kind: "unchanged", user: current } as const;
      if (current.status !== "pending" && current.status !== "blocked") return { kind: "invalid_state" } as const;
      await client.query("UPDATE app_users SET status='active',updated_at=now() WHERE id=$1", [userId]);
      const action = current.status === "blocked" ? "internal_user.reactivated" : "internal_user.activated";
      await insertAuditEvent(client, {
        ...audit, actorUserId, action, entityType: "app_user", entityId: userId,
        oldValues: { status: current.status }, newValues: { status: "active" },
      });
      return { kind: "changed", user: (await findInternalById(client, userId))! } as const;
    });
  }

  block(userId: string, actorUserId: string, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox-internal-user-administration'))");
      const current = await findInternalById(client, userId, true);
      if (current === null) return { kind: "not_found" } as const;
      if (current.status === "deleted") return { kind: "deleted" } as const;
      if (current.status === "blocked") return { kind: "unchanged", user: current } as const;
      if (current.status !== "active") return { kind: "invalid_state" } as const;
      if (await hasEffectiveAdminPermission(client, userId) && !await otherActiveAdministratorExists(client, userId)) {
        return { kind: "last_administrator" } as const;
      }
      await client.query("UPDATE app_users SET status='blocked',updated_at=now() WHERE id=$1", [userId]);
      await insertAuditEvent(client, {
        ...audit, actorUserId, action: "internal_user.blocked", entityType: "app_user", entityId: userId,
        oldValues: { status: "active" }, newValues: { status: "blocked" },
      });
      return { kind: "changed", user: (await findInternalById(client, userId))! } as const;
    });
  }

  grantRole(userId: string, roleCode: string, actorUserId: string, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox-internal-user-administration'))");
      const current = await findInternalById(client, userId, true);
      if (current === null) return { kind: "not_found" } as const;
      if (current.status === "deleted") return { kind: "deleted" } as const;
      if (roleCode === "super_admin") return { kind: "protected_role" } as const;
      const role = await client.query<{ readonly id: string }>(
        `SELECT r.id FROM roles r WHERE r.scope='global' AND r.code=$2
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions target_rp WHERE target_rp.role_id=r.id AND NOT EXISTS (
             SELECT 1 FROM user_roles actor_ur
             JOIN roles actor_r ON actor_r.id=actor_ur.role_id AND actor_r.scope='global'
             JOIN role_permissions actor_rp ON actor_rp.role_id=actor_r.id
             WHERE actor_ur.user_id=$1 AND actor_rp.permission_id=target_rp.permission_id))
         FOR UPDATE`,
        [actorUserId, roleCode],
      );
      const roleId = role.rows[0]?.id;
      if (roleId === undefined) return { kind: "role_not_assignable" } as const;
      const inserted = await client.query(
        `INSERT INTO user_roles (user_id,role_id,role_scope,assigned_by_user_id)
         VALUES ($1,$2,'global',$3) ON CONFLICT (user_id,role_id) DO NOTHING`,
        [userId, roleId, actorUserId],
      );
      if (inserted.rowCount === 0) return { kind: "unchanged", user: current } as const;
      await insertAuditEvent(client, {
        ...audit, actorUserId, action: "internal_user.role_granted", entityType: "app_user", entityId: userId,
        newValues: { roleCode },
      });
      return { kind: "changed", user: (await findInternalById(client, userId))! } as const;
    });
  }

  revokeRole(userId: string, roleCode: string, actorUserId: string, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox-internal-user-administration'))");
      const current = await findInternalById(client, userId, true);
      if (current === null) return { kind: "not_found" } as const;
      if (current.status === "deleted") return { kind: "deleted" } as const;
      if (roleCode === "super_admin") return { kind: "protected_role" } as const;
      const role = await client.query<{ readonly id: string }>(
        "SELECT id FROM roles WHERE scope='global' AND code=$1 FOR UPDATE", [roleCode],
      );
      const roleId = role.rows[0]?.id;
      if (roleId === undefined) return { kind: "role_not_assignable" } as const;
      const assigned = await client.query("SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2", [userId, roleId]);
      if (assigned.rowCount === 0) return { kind: "unchanged", user: current } as const;
      if (current.status === "active" && await hasEffectiveAdminPermission(client, userId) &&
          !await hasEffectiveAdminPermission(client, userId, roleId) && !await otherActiveAdministratorExists(client, userId)) {
        return { kind: "last_administrator" } as const;
      }
      const internalRoleCount = await client.query<{ readonly total: number }>(
        `SELECT count(*)::integer AS total FROM user_roles ur JOIN roles r
         ON r.id=ur.role_id AND r.scope='global' WHERE ur.user_id=$1`, [userId],
      );
      if ((internalRoleCount.rows[0]?.total ?? 0) <= 1) return { kind: "last_internal_role" } as const;
      await client.query("DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2", [userId, roleId]);
      await insertAuditEvent(client, {
        ...audit, actorUserId, action: "internal_user.role_revoked", entityType: "app_user", entityId: userId,
        oldValues: { roleCode },
      });
      const updated = await findInternalById(client, userId);
      return { kind: "changed", user: updated ?? { ...current, internalRoles: [], effectivePermissions: [] } } as const;
    });
  }

  async resolveContext(
    scope: AuthorizedRepositoryScope,
    input: EligibilityContext,
  ): Promise<ResolvedEligibilityContext | null> {
    let resource: "organization" | "project" | "task" | "ticket" | "lead";
    let id: string;
    let table: string;
    let select: string;
    if (input.organizationId !== undefined) {
      resource = "organization"; id = input.organizationId; table = "organizations o";
      select = "o.id AS organization_id, NULL::uuid AS project_id";
    } else if (input.projectId !== undefined) {
      resource = "project"; id = input.projectId; table = "projects p";
      select = "p.organization_id, p.id AS project_id";
    } else if (input.taskId !== undefined) {
      resource = "task"; id = input.taskId; table = "tasks t";
      select = "t.organization_id, t.project_id";
    } else if (input.ticketId !== undefined) {
      resource = "ticket"; id = input.ticketId; table = "tickets tk";
      select = "tk.organization_id, tk.project_id";
    } else {
      resource = "lead"; id = input.leadId!; table = "leads l";
      select = "NULL::uuid AS organization_id, NULL::uuid AS project_id";
    }
    const scoped = scopeSql(scope, resource, 2);
    const extra = resource === "task" ? " AND t.ticket_id IS NULL" : "";
    const result = await this.pool.query<ContextRow>(
      `SELECT ${select} FROM ${table} WHERE ${table.split(" ")[1]}.id = $1 AND ${scoped.sql}${extra}`,
      [id, ...scoped.values],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
      ...(row.project_id === null ? {} : { projectId: row.project_id }),
    };
  }

  async listEligible(
    purpose: EligibleUserPurpose,
    context: ResolvedEligibilityContext,
    search?: string,
  ): Promise<readonly EligibleUserItem[]> {
    const values: unknown[] = [];
    const clauses = ["u.status = 'active'"];
    if (search !== undefined) {
      values.push(search);
      clauses.push(`(u.primary_email ILIKE '%' || $${values.length} || '%' OR
        concat_ws(' ', u.first_name, u.last_name) ILIKE '%' || $${values.length} || '%')`);
    }
    const push = (value: unknown): string => { values.push(value); return `$${values.length}`; };
    if (purpose === "organization_account_manager") {
      clauses.push(globalPermission("organizations.manage"));
    } else if (purpose === "project_lead") {
      clauses.push(globalPermission("projects.manage"));
    } else if (purpose === "lead_assignee") {
      clauses.push(globalPermission("leads.manage"));
    } else if (purpose === "ticket_assignee") {
      const project = context.projectId === undefined ? undefined : push(context.projectId);
      clauses.push(`EXISTS (SELECT 1 FROM user_roles internal_ur JOIN roles internal_r ON internal_r.id = internal_ur.role_id
        WHERE internal_ur.user_id = u.id AND internal_r.scope = 'global')`);
      clauses.push(`(${globalPermission("tickets.assign")}${project === undefined ? "" : ` OR EXISTS (
        SELECT 1 FROM project_members eligible_pm
        JOIN role_permissions eligible_rp ON eligible_rp.role_id = eligible_pm.role_id
        JOIN permissions eligible_p ON eligible_p.id = eligible_rp.permission_id AND eligible_p.code = 'tickets.assign'
        WHERE eligible_pm.project_id = ${project} AND eligible_pm.user_id = u.id AND eligible_pm.status = 'active')`})`);
    } else if (purpose === "project_member") {
      const organization = push(context.organizationId);
      const project = push(context.projectId);
      clauses.push(`(EXISTS (SELECT 1 FROM user_roles internal_ur JOIN roles internal_r ON internal_r.id = internal_ur.role_id
        JOIN role_permissions internal_rp ON internal_rp.role_id = internal_r.id
        JOIN permissions internal_p ON internal_p.id = internal_rp.permission_id AND internal_p.code = 'projects.read'
        WHERE internal_ur.user_id = u.id AND internal_r.scope = 'global') OR EXISTS (
          SELECT 1 FROM organization_memberships eligible_om
          JOIN organizations eligible_o ON eligible_o.id = eligible_om.organization_id AND eligible_o.status = 'active'
          WHERE eligible_om.organization_id = ${organization} AND eligible_om.user_id = u.id AND eligible_om.status = 'active'))`);
      clauses.push(`NOT EXISTS (SELECT 1 FROM project_members current_pm
        WHERE current_pm.project_id = ${project} AND current_pm.user_id = u.id)`);
    } else if (context.projectId === undefined) {
      clauses.push(globalPermission("tasks.manage"));
    } else {
      const project = push(context.projectId);
      clauses.push(`EXISTS (SELECT 1 FROM user_roles internal_ur
        JOIN roles internal_r ON internal_r.id = internal_ur.role_id AND internal_r.scope = 'global'
        WHERE internal_ur.user_id = u.id)`);
      clauses.push(`(EXISTS (SELECT 1 FROM project_members task_pm
          WHERE task_pm.project_id = ${project} AND task_pm.user_id = u.id AND task_pm.status = 'active')
        OR EXISTS (SELECT 1 FROM projects task_p WHERE task_p.id = ${project} AND task_p.lead_user_id = u.id)
        OR ${globalPermission("tasks.manage")})`);
    }
    const result = await this.pool.query<CatalogRow>(
      `${CATALOG_SQL} WHERE ${clauses.join(" AND ")}
       GROUP BY u.id
       ORDER BY display_name ASC, u.id ASC
       LIMIT 100`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      roles: row.roles,
    }));
  }
}
