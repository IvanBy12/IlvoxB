import type { Pool, PoolClient, QueryResultRow } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type {
  TicketCommentRecord,
  TicketCommentVisibility,
  TicketCreateInput,
  TicketListInput,
  TicketPatch,
  TicketPriority,
  TicketRecord,
  TicketRepository,
  TicketWriteResult,
} from "./ticket.types.js";
import type { TicketStatus } from "../../common/state-machines/ticket-transitions.js";

interface TicketRow extends QueryResultRow {
  readonly id: string;
  readonly organization_id: string | null;
  readonly project_id: string | null;
  readonly requester_user_id: string;
  readonly assigned_to_user_id: string | null;
  readonly code: string;
  readonly type: TicketRecord["type"];
  readonly requested_priority: TicketPriority;
  readonly priority: TicketPriority;
  readonly status: TicketStatus;
  readonly subject: string;
  readonly description: string;
  readonly resolution: string | null;
  readonly resolved_at: Date | null;
  readonly closed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ProjectRow extends QueryResultRow {
  readonly id: string;
  readonly organization_id: string;
  readonly status: string;
}

interface CommentRow extends QueryResultRow {
  readonly id: string;
  readonly ticket_id: string;
  readonly organization_id: string | null;
  readonly author_user_id: string;
  readonly visibility: TicketCommentVisibility;
  readonly content: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const TICKET_COLUMNS = `t.id, t.organization_id, t.project_id, t.requester_user_id,
  t.assigned_to_user_id, t.code, t.type, t.requested_priority, t.priority, t.status,
  t.subject, t.description, t.resolution, t.resolved_at, t.closed_at, t.created_at, t.updated_at`;

function mapTicket(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    requesterUserId: row.requester_user_id,
    assignedToUserId: row.assigned_to_user_id,
    code: row.code,
    type: row.type,
    requestedPriority: row.requested_priority,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    description: row.description,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapComment(row: CommentRow): TicketCommentRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    organizationId: row.organization_id,
    authorUserId: row.author_user_id,
    visibility: row.visibility,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ticketScope(
  scope: AuthorizedRepositoryScope,
  alias = "t",
  startAt = 1,
): { readonly sql: string; readonly values: readonly unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public") return { sql: "false", values: [] };
  if (scope.kind === "own") {
    return {
      sql: `${alias}.requester_user_id = $${startAt}
        AND (
          ${alias}.organization_id IS NULL
          OR EXISTS (
            SELECT 1 FROM organization_memberships own_om
            WHERE own_om.organization_id = ${alias}.organization_id
              AND own_om.user_id = $${startAt}
              AND own_om.status = 'active'
          )
        )`,
      values: [scope.actorId],
    };
  }
  if (scope.kind === "organization") {
    if (scope.organizationIds.length === 0) return { sql: "false", values: [] };
    return {
      sql: `${alias}.organization_id = ANY($${startAt}::uuid[])
        AND EXISTS (
          SELECT 1 FROM organization_memberships scoped_om
          WHERE scoped_om.organization_id = ${alias}.organization_id
            AND scoped_om.user_id = $${startAt + 1}
            AND scoped_om.status = 'active'
        )`,
      values: [[...scope.organizationIds], scope.actorId],
    };
  }
  return {
    sql: `(
      ${alias}.assigned_to_user_id = $${startAt}
      OR (
        ${alias}.requester_user_id = $${startAt}
        AND (
          ${alias}.organization_id IS NULL
          OR EXISTS (
            SELECT 1 FROM organization_memberships assigned_own_om
            WHERE assigned_own_om.organization_id = ${alias}.organization_id
              AND assigned_own_om.user_id = $${startAt}
              AND assigned_own_om.status = 'active'
          )
        )
      )
      OR (
        ${alias}.project_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM project_members scoped_pm
          WHERE scoped_pm.project_id = ${alias}.project_id
            AND scoped_pm.organization_id = ${alias}.organization_id
            AND scoped_pm.user_id = $${startAt}
            AND scoped_pm.status = 'active'
        )
      )
    )`,
    values: [scope.actorId],
  };
}

function createContextScope(
  scope: AuthorizedRepositoryScope,
  organizationExpression: string,
  projectExpression: string | null,
  startAt: number,
): { readonly sql: string; readonly values: readonly unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public") return { sql: "false", values: [] };
  if (scope.kind === "organization") {
    if (scope.organizationIds.length === 0) return { sql: "false", values: [] };
    return {
      sql: `${organizationExpression} = ANY($${startAt}::uuid[])
        AND EXISTS (
          SELECT 1 FROM organization_memberships create_om
          WHERE create_om.organization_id = ${organizationExpression}
            AND create_om.user_id = $${startAt + 1}
            AND create_om.status = 'active'
        )`,
      values: [[...scope.organizationIds], scope.actorId],
    };
  }
  if (scope.kind === "own") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM organization_memberships create_om
        WHERE create_om.organization_id = ${organizationExpression}
          AND create_om.user_id = $${startAt}
          AND create_om.status = 'active'
      )`,
      values: [scope.actorId],
    };
  }
  if (projectExpression === null) return { sql: "false", values: [] };
  return {
    sql: `EXISTS (
      SELECT 1 FROM project_members create_pm
      WHERE create_pm.project_id = ${projectExpression}
        AND create_pm.organization_id = ${organizationExpression}
        AND create_pm.user_id = $${startAt}
        AND create_pm.status = 'active'
    )`,
    values: [scope.actorId],
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

async function lockedTicket(
  client: PoolClient,
  scope: AuthorizedRepositoryScope,
  ticketId: string,
): Promise<TicketRecord | null> {
  const scoped = ticketScope(scope, "t", 2);
  const result = await client.query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM tickets t
     WHERE t.id = $1 AND ${scoped.sql}
     FOR UPDATE`,
    [ticketId, ...scoped.values],
  );
  return result.rows[0] === undefined ? null : mapTicket(result.rows[0]);
}

function sameTimestamp(actual: Date, expected: Date | undefined): boolean {
  return expected === undefined || actual.getTime() === expected.getTime();
}

export class PostgresTicketRepository implements TicketRepository {
  constructor(private readonly pool: Pool) {}

  async listAuthorized(scope: AuthorizedRepositoryScope, input: TicketListInput) {
    const scoped = ticketScope(scope);
    const clauses = [scoped.sql];
    const values: unknown[] = [...scoped.values];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace("?", `$${values.length}`));
    };
    if (input.search !== undefined) {
      const pattern = `%${input.search}%`;
      values.push(pattern, pattern, pattern);
      clauses.push(
        `(t.code ILIKE $${values.length - 2} OR t.subject ILIKE $${values.length - 1} OR t.description ILIKE $${values.length})`,
      );
    }
    if (input.status !== undefined) add("t.status = ?", input.status);
    if (input.priority !== undefined) add("t.priority = ?", input.priority);
    if (input.organizationId !== undefined) add("t.organization_id = ?", input.organizationId);
    if (input.projectId !== undefined) add("t.project_id = ?", input.projectId);
    if (input.requesterUserId !== undefined) add("t.requester_user_id = ?", input.requesterUserId);
    if (input.assignedToUserId !== undefined) add("t.assigned_to_user_id = ?", input.assignedToUserId);
    if (input.createdFrom !== undefined) add("t.created_at >= ?", input.createdFrom);
    if (input.createdTo !== undefined) add("t.created_at <= ?", input.createdTo);
    if (input.updatedFrom !== undefined) add("t.updated_at >= ?", input.updatedFrom);
    if (input.updatedTo !== undefined) add("t.updated_at <= ?", input.updatedTo);

    const where = clauses.join(" AND ");
    const count = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM tickets t WHERE ${where}`,
      values,
    );
    const sortColumns: Record<TicketListInput["sortBy"], string> = {
      createdAt: "t.created_at",
      updatedAt: "t.updated_at",
      code: "t.code",
      priority: "t.priority",
      status: "t.status",
    };
    const pageValues = [...values, input.pageSize, paginationOffset(input)];
    const rows = await this.pool.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets t
       WHERE ${where}
       ORDER BY ${sortColumns[input.sortBy]} ${input.sortDirection === "asc" ? "ASC" : "DESC"}, t.id ASC
       LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return { items: rows.rows.map(mapTicket), pagination: paginationMeta(input, total) };
  }

  async findAuthorized(scope: AuthorizedRepositoryScope, ticketId: string): Promise<TicketRecord | null> {
    const scoped = ticketScope(scope, "t", 2);
    const result = await this.pool.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets t WHERE t.id = $1 AND ${scoped.sql}`,
      [ticketId, ...scoped.values],
    );
    return result.rows[0] === undefined ? null : mapTicket(result.rows[0]);
  }

  async create(
    scope: AuthorizedRepositoryScope,
    input: TicketCreateInput,
    requesterUserId: string,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>> {
    return transaction(this.pool, async (client) => {
      let organizationId = input.organizationId ?? null;
      if (input.projectId !== undefined) {
        const contextScope = createContextScope(scope, "p.organization_id", "p.id", 2);
        const project = await client.query<ProjectRow>(
          `SELECT p.id, p.organization_id, p.status FROM projects p
           WHERE p.id = $1 AND ${contextScope.sql}
           FOR UPDATE`,
          [input.projectId, ...contextScope.values],
        );
        const row = project.rows[0];
        if (row === undefined) return "invalid_context";
        if (["delivered", "cancelled"].includes(row.status)) return "project_closed";
        if (organizationId !== null && organizationId !== row.organization_id) return "invalid_context";
        organizationId = row.organization_id;
      } else if (organizationId !== null) {
        const contextScope = createContextScope(scope, "o.id", null, 2);
        const allowed = await client.query(
          `SELECT 1 FROM organizations o
           WHERE o.id = $1 AND o.status = 'active' AND ${contextScope.sql}
           FOR UPDATE`,
          [organizationId, ...contextScope.values],
        );
        if (allowed.rowCount !== 1) return "invalid_context";
      } else if (scope.kind !== "own" && scope.kind !== "global") {
        return "invalid_context";
      }

      const inserted = await client.query<TicketRow>(
        `INSERT INTO tickets (
           organization_id, project_id, requester_user_id, type, requested_priority,
           subject, description
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, organization_id, project_id, requester_user_id, assigned_to_user_id,
           code, type, requested_priority, priority, status, subject, description, resolution,
           resolved_at, closed_at, created_at, updated_at`,
        [
          organizationId,
          input.projectId ?? null,
          requesterUserId,
          input.type,
          input.requestedPriority ?? "medium",
          input.subject.trim(),
          input.description.trim(),
        ],
      );
      const ticket = mapTicket(inserted.rows[0]!);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: "ticket.created",
        entityType: "ticket",
        entityId: ticket.id,
        newValues: {
          organizationId: ticket.organizationId,
          projectId: ticket.projectId,
          requesterUserId,
          type: ticket.type,
          requestedPriority: ticket.requestedPriority,
          status: ticket.status,
        },
      });
      return ticket;
    });
  }

  async update(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    input: TicketPatch,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await lockedTicket(client, scope, ticketId);
      if (current === null) return "not_found";
      if (!sameTimestamp(current.updatedAt, input.expectedUpdatedAt)) return "conflict";
      if (["closed", "cancelled"].includes(current.status)) return "conflict";
      const next = {
        subject: input.subject?.trim() ?? current.subject,
        description: input.description?.trim() ?? current.description,
        requestedPriority: input.requestedPriority ?? current.requestedPriority,
      };
      const result = await client.query<TicketRow>(
        `UPDATE tickets SET subject = $2, description = $3, requested_priority = $4, updated_at = now()
         WHERE id = $1
         RETURNING id, organization_id, project_id, requester_user_id, assigned_to_user_id,
           code, type, requested_priority, priority, status, subject, description, resolution,
           resolved_at, closed_at, created_at, updated_at`,
        [ticketId, next.subject, next.description, next.requestedPriority],
      );
      const ticket = mapTicket(result.rows[0]!);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: "ticket.updated",
        entityType: "ticket",
        entityId: ticket.id,
        oldValues: { requestedPriority: current.requestedPriority },
        newValues: { requestedPriority: ticket.requestedPriority },
      });
      return ticket;
    });
  }

  async assign(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    assignedToUserId: string | null,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await lockedTicket(client, scope, ticketId);
      if (current === null) return "not_found";
      if (!sameTimestamp(current.updatedAt, expectedUpdatedAt)) return "conflict";
      if (["closed", "cancelled"].includes(current.status)) return "conflict";
      if (assignedToUserId !== null) {
        const eligible = await client.query(
          `SELECT 1 FROM app_users u
           WHERE u.id = $1 AND u.status = 'active'
             AND EXISTS (
               SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id AND r.scope = 'global'
             )`,
          [assignedToUserId],
        );
        if (eligible.rowCount !== 1) return "ineligible_user";
      }
      const result = await client.query<TicketRow>(
        `UPDATE tickets SET assigned_to_user_id = $2, updated_at = now()
         WHERE id = $1
         RETURNING id, organization_id, project_id, requester_user_id, assigned_to_user_id,
           code, type, requested_priority, priority, status, subject, description, resolution,
           resolved_at, closed_at, created_at, updated_at`,
        [ticketId, assignedToUserId],
      );
      const ticket = mapTicket(result.rows[0]!);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: assignedToUserId === null ? "ticket.unassigned" : "ticket.assigned",
        entityType: "ticket",
        entityId: ticket.id,
        oldValues: { assignedToUserId: current.assignedToUserId },
        newValues: { assignedToUserId },
      });
      return ticket;
    });
  }

  async changePriority(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    priority: TicketPriority,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await lockedTicket(client, scope, ticketId);
      if (current === null) return "not_found";
      if (!sameTimestamp(current.updatedAt, expectedUpdatedAt)) return "conflict";
      if (["closed", "cancelled"].includes(current.status)) return "conflict";
      const result = await client.query<TicketRow>(
        `UPDATE tickets SET priority = $2, updated_at = now() WHERE id = $1
         RETURNING id, organization_id, project_id, requester_user_id, assigned_to_user_id,
           code, type, requested_priority, priority, status, subject, description, resolution,
           resolved_at, closed_at, created_at, updated_at`,
        [ticketId, priority],
      );
      const ticket = mapTicket(result.rows[0]!);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: "ticket.priority_changed",
        entityType: "ticket",
        entityId: ticket.id,
        oldValues: { priority: current.priority },
        newValues: { priority },
      });
      return ticket;
    });
  }

  async transition(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    currentStatus: TicketStatus,
    nextStatus: TicketStatus,
    resolution: string | undefined,
    reason: string | undefined,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await lockedTicket(client, scope, ticketId);
      if (current === null) return "not_found";
      if (current.status !== currentStatus || !sameTimestamp(current.updatedAt, expectedUpdatedAt)) return "conflict";
      const result = await client.query<TicketRow>(
        `UPDATE tickets SET
           status = $2,
           resolution = CASE WHEN $2 = 'resolved' THEN $3 ELSE resolution END,
           resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END,
           closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
           updated_at = now()
         WHERE id = $1 AND status = $4
         RETURNING id, organization_id, project_id, requester_user_id, assigned_to_user_id,
           code, type, requested_priority, priority, status, subject, description, resolution,
           resolved_at, closed_at, created_at, updated_at`,
        [ticketId, nextStatus, resolution?.trim() ?? null, currentStatus],
      );
      if (result.rows[0] === undefined) return "conflict";
      const ticket = mapTicket(result.rows[0]);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: nextStatus === "resolved"
          ? "ticket.resolved"
          : nextStatus === "closed"
            ? "ticket.closed"
            : nextStatus === "reopened"
              ? "ticket.reopened"
              : "ticket.transitioned",
        entityType: "ticket",
        entityId: ticket.id,
        oldValues: { status: current.status },
        newValues: {
          status: nextStatus,
          ...(reason === undefined ? {} : { reason: reason.trim().slice(0, 240) }),
        },
      });
      return ticket;
    });
  }

  async confirmResolution(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    decision: "confirm" | "reject",
    reason: string | undefined,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>> {
    return transaction(this.pool, async (client) => {
      const current = await lockedTicket(client, scope, ticketId);
      if (current === null) return "not_found";
      if (current.status !== "resolved" || !sameTimestamp(current.updatedAt, expectedUpdatedAt)) return "conflict";
      const nextStatus = decision === "confirm" ? "closed" : "reopened";
      const result = await client.query<TicketRow>(
        `UPDATE tickets SET status = $2,
           closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
           updated_at = now()
         WHERE id = $1 AND status = 'resolved'
         RETURNING id, organization_id, project_id, requester_user_id, assigned_to_user_id,
           code, type, requested_priority, priority, status, subject, description, resolution,
           resolved_at, closed_at, created_at, updated_at`,
        [ticketId, nextStatus],
      );
      if (result.rows[0] === undefined) return "conflict";
      const ticket = mapTicket(result.rows[0]);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: decision === "confirm" ? "ticket.resolution_confirmed" : "ticket.resolution_rejected",
        entityType: "ticket",
        entityId: ticket.id,
        oldValues: { status: current.status },
        newValues: {
          status: nextStatus,
          ...(reason === undefined ? {} : { reason: reason.trim().slice(0, 240) }),
        },
      });
      return ticket;
    });
  }

  async listComments(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    includeInternal: boolean,
  ): Promise<readonly TicketCommentRecord[] | null> {
    const ticket = await this.findAuthorized(scope, ticketId);
    if (ticket === null) return null;
    const rows = await this.pool.query<CommentRow>(
      `SELECT id, ticket_id, organization_id, author_user_id, visibility, content, created_at, updated_at
       FROM ticket_comments
       WHERE ticket_id = $1 ${includeInternal ? "" : "AND visibility = 'client'"}
       ORDER BY created_at ASC, id ASC`,
      [ticketId],
    );
    return rows.rows.map(mapComment);
  }

  async createComment(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    authorUserId: string,
    visibility: TicketCommentVisibility,
    content: string,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketCommentRecord>> {
    return transaction(this.pool, async (client) => {
      const ticket = await lockedTicket(client, scope, ticketId);
      if (ticket === null) return "not_found";
      const result = await client.query<CommentRow>(
        `INSERT INTO ticket_comments (
           ticket_id, organization_id, author_user_id, visibility, content
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, ticket_id, organization_id, author_user_id, visibility, content,
           created_at, updated_at`,
        [ticketId, ticket.organizationId, authorUserId, visibility, content.trim()],
      );
      const comment = mapComment(result.rows[0]!);
      await insertAuditEvent(client, {
        ...audit,
        ...(ticket.organizationId === null ? {} : { organizationId: ticket.organizationId }),
        action: "ticket_comment.created",
        entityType: "ticket_comment",
        entityId: comment.id,
        newValues: { ticketId, authorUserId, visibility },
      });
      return comment;
    });
  }
}
