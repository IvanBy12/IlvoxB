import type { Pool } from "pg";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { FileAudience, FileStatus } from "./file-authorization.js";

export interface AuthorizedFileRow {
  readonly id: string;
  readonly organization_id: string;
  readonly uploaded_by_user_id: string;
  readonly original_name: string;
  readonly storage_provider: string;
  readonly object_key: string;
  readonly mime_type: string;
  readonly size_bytes: string;
  readonly audience: FileAudience;
  readonly status: FileStatus;
}

interface Predicate { readonly sql: string; readonly values: readonly unknown[]; }

function scopePredicate(scope: AuthorizedRepositoryScope, startIndex: number): Predicate {
  if (scope.kind === "global") return { sql: "TRUE", values: [] };
  if (scope.kind === "public") return { sql: "FALSE", values: [] };
  const organizationIndex = startIndex;
  const actorIndex = startIndex + 1;
  const organization = `f.organization_id = ANY($${organizationIndex}::uuid[])`;
  if (scope.kind === "organization") return { sql: organization, values: [[...scope.organizationIds]] };
  if (scope.kind === "own") {
    return {
      sql: `${organization} AND (f.uploaded_by_user_id=$${actorIndex} OR EXISTS (
        SELECT 1 FROM tickets t WHERE t.id=f.ticket_id AND t.organization_id=f.organization_id
          AND t.requester_user_id=$${actorIndex}))`,
      values: [[...scope.organizationIds], scope.actorId],
    };
  }
  return {
    sql: `${organization} AND (
      f.uploaded_by_user_id=$${actorIndex}
      OR EXISTS (SELECT 1 FROM tickets t WHERE t.id=f.ticket_id AND t.organization_id=f.organization_id
        AND (t.requester_user_id=$${actorIndex} OR t.assigned_to_user_id=$${actorIndex}))
      OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=f.project_id
        AND pm.organization_id=f.organization_id AND pm.user_id=$${actorIndex})
      OR EXISTS (SELECT 1 FROM tasks ta WHERE ta.id=f.task_id AND ta.organization_id=f.organization_id
        AND ta.assigned_to_user_id=$${actorIndex})
      OR EXISTS (SELECT 1 FROM ticket_comments tc JOIN tickets t ON t.id=tc.ticket_id
        AND t.organization_id=tc.organization_id WHERE tc.id=f.ticket_comment_id
        AND tc.organization_id=f.organization_id
        AND (t.requester_user_id=$${actorIndex} OR t.assigned_to_user_id=$${actorIndex}))
      OR EXISTS (SELECT 1 FROM deliverables d JOIN project_members pm ON pm.project_id=d.project_id
        AND pm.organization_id=d.organization_id WHERE d.id=f.deliverable_id
        AND d.organization_id=f.organization_id AND pm.user_id=$${actorIndex})
    )`,
    values: [[...scope.organizationIds], scope.actorId],
  };
}

export class FileRepository {
  constructor(private readonly pool: Pool) {}

  async findAuthorizedById(
    fileId: string,
    scope: AuthorizedRepositoryScope,
    audiences: readonly FileAudience[],
  ): Promise<AuthorizedFileRow | null> {
    const predicate = scopePredicate(scope, 3);
    if (audiences.length === 0) return null;
    const result = await this.pool.query<AuthorizedFileRow>(
      `SELECT f.id,f.organization_id,f.uploaded_by_user_id,f.original_name,f.storage_provider,
              f.object_key,f.mime_type,f.size_bytes,f.audience,f.status
       FROM files f
       WHERE f.id=$1 AND f.audience=ANY($2::varchar[]) AND f.deleted_at IS NULL
         AND (${predicate.sql})`,
      [fileId, [...audiences], ...predicate.values],
    );
    return result.rows[0] ?? null;
  }

  async countAuthorized(scope: AuthorizedRepositoryScope, audiences: readonly FileAudience[]): Promise<number> {
    const predicate = scopePredicate(scope, 2);
    if (audiences.length === 0) return 0;
    const result = await this.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM files f
       WHERE f.audience=ANY($1::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql})`,
      [[...audiences], ...predicate.values],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listAuthorized(
    scope: AuthorizedRepositoryScope,
    audiences: readonly FileAudience[],
    limit: number,
    offset: number,
  ): Promise<readonly AuthorizedFileRow[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const boundedOffset = Math.max(offset, 0);
    const predicate = scopePredicate(scope, 4);
    if (audiences.length === 0) return [];
    const result = await this.pool.query<AuthorizedFileRow>(
      `SELECT f.id,f.organization_id,f.uploaded_by_user_id,f.original_name,f.storage_provider,
              f.object_key,f.mime_type,f.size_bytes,f.audience,f.status
       FROM files f
       WHERE f.audience=ANY($1::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql})
       ORDER BY f.created_at DESC, f.id DESC LIMIT $2 OFFSET $3`,
      [[...audiences], boundedLimit, boundedOffset, ...predicate.values],
    );
    return result.rows;
  }

  async searchAuthorized(
    scope: AuthorizedRepositoryScope,
    audiences: readonly FileAudience[],
    term: string,
    limit = 25,
  ): Promise<readonly AuthorizedFileRow[]> {
    const predicate = scopePredicate(scope, 4);
    if (audiences.length === 0 || term.trim() === "") return [];
    const result = await this.pool.query<AuthorizedFileRow>(
      `SELECT f.id,f.organization_id,f.uploaded_by_user_id,f.original_name,f.storage_provider,
              f.object_key,f.mime_type,f.size_bytes,f.audience,f.status
       FROM files f
       WHERE f.audience=ANY($1::varchar[]) AND f.original_name ILIKE $2 ESCAPE '\\'
         AND f.deleted_at IS NULL AND (${predicate.sql})
       ORDER BY f.created_at DESC, f.id DESC LIMIT $3`,
      [[...audiences], `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
        Math.min(Math.max(limit, 1), 100), ...predicate.values],
    );
    return result.rows;
  }

  async aggregateByAudience(
    scope: AuthorizedRepositoryScope,
    audiences: readonly FileAudience[],
  ): Promise<Readonly<Record<FileAudience, number>>> {
    const predicate = scopePredicate(scope, 2);
    const totals: Record<FileAudience, number> = { internal: 0, organization: 0 };
    if (audiences.length === 0) return totals;
    const result = await this.pool.query<{ readonly audience: FileAudience; readonly count: string }>(
      `SELECT f.audience, count(*)::text AS count FROM files f
       WHERE f.audience=ANY($1::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql})
       GROUP BY f.audience`, [[...audiences], ...predicate.values],
    );
    for (const row of result.rows) totals[row.audience] = Number(row.count);
    return totals;
  }
}
