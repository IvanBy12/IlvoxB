import type { Pool, PoolClient, QueryResultRow } from "pg";
import { insertAuditEvent } from "../../common/audit/audit.js";
import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { FileAudience, FileStatus } from "./file-authorization.js";
import type {
  CreatePendingFileInput, DeliverableFileContext, FileRecord, FileRepositoryPort, FileWriteResult,
} from "./file.types.js";

interface Predicate { readonly sql: string; readonly values: readonly unknown[]; }
interface FileRow extends QueryResultRow {
  readonly id: string; readonly organization_id: string; readonly project_id: string | null;
  readonly deliverable_id: string | null; readonly uploaded_by_user_id: string; readonly uploaded_by_name: string;
  readonly original_name: string; readonly storage_provider: string; readonly object_key: string;
  readonly mime_type: string; readonly size_bytes: string; readonly checksum_sha256: string | null; readonly audience: FileAudience;
  readonly status: FileStatus; readonly created_at: Date; readonly delivery_party: FileRecord["deliverableParty"];
  readonly deliverable_status: FileRecord["deliverableStatus"];
}
interface DeliverableRow extends QueryResultRow {
  readonly id: string; readonly project_id: string; readonly organization_id: string;
  readonly delivery_party: DeliverableFileContext["deliveryParty"];
  readonly due_date: string | null; readonly status: DeliverableFileContext["status"];
}

const FILE_SELECT = `SELECT f.id,f.organization_id,f.project_id,f.deliverable_id,f.uploaded_by_user_id,
  COALESCE(nullif(concat_ws(' ', uploader.first_name, uploader.last_name), ''), uploader.primary_email) AS uploaded_by_name,
  f.original_name,f.storage_provider,f.object_key,f.mime_type,f.size_bytes::text,f.checksum_sha256,f.audience,f.status,f.created_at,
  d.delivery_party,d.status AS deliverable_status
  FROM files f JOIN app_users uploader ON uploader.id=f.uploaded_by_user_id
  LEFT JOIN deliverables d ON d.id=f.deliverable_id AND d.organization_id=f.organization_id`;

function mapFile(row: FileRow): FileRecord {
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id,
    deliverableId: row.deliverable_id, uploadedByUserId: row.uploaded_by_user_id,
    uploadedByName: row.uploaded_by_name, originalName: row.original_name,
    storageProvider: row.storage_provider, objectKey: row.object_key, mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes), checksumSha256: row.checksum_sha256, audience: row.audience, status: row.status,
    createdAt: row.created_at, deliverableParty: row.delivery_party, deliverableStatus: row.deliverable_status };
}

function scopePredicate(scope: AuthorizedRepositoryScope, startIndex: number): Predicate {
  if (scope.kind === "global") return { sql: "TRUE", values: [] };
  if (scope.kind === "public") return { sql: "FALSE", values: [] };
  const organization = `f.organization_id = ANY($${startIndex}::uuid[])`;
  const actorIndex = startIndex + 1;
  if (scope.kind === "organization") return { sql: organization, values: [[...scope.organizationIds]] };
  if (scope.kind === "own") return { sql: `${organization} AND f.uploaded_by_user_id=$${actorIndex}`, values: [[...scope.organizationIds], scope.actorId] };
  return { sql: `${organization} AND (f.uploaded_by_user_id=$${actorIndex} OR EXISTS (
    SELECT 1 FROM deliverables scoped_d JOIN project_members scoped_pm ON scoped_pm.project_id=scoped_d.project_id
      AND scoped_pm.organization_id=scoped_d.organization_id AND scoped_pm.status='active'
    WHERE scoped_d.id=f.deliverable_id AND scoped_pm.user_id=$${actorIndex}))`, values: [[...scope.organizationIds], scope.actorId] };
}

function deliverablePredicate(scope: AuthorizedRepositoryScope, startIndex: number): Predicate {
  if (scope.kind === "global") return { sql: "TRUE", values: [] };
  if (scope.kind === "public") return { sql: "FALSE", values: [] };
  if (scope.kind === "organization") return { sql: `d.organization_id=ANY($${startIndex}::uuid[])`, values: [[...scope.organizationIds]] };
  if (scope.kind === "own") return { sql: `d.organization_id=ANY($${startIndex}::uuid[]) AND p.created_by_user_id=$${startIndex + 1}`, values: [[...scope.organizationIds], scope.actorId] };
  return { sql: `d.organization_id=ANY($${startIndex}::uuid[]) AND EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id=d.project_id AND pm.organization_id=d.organization_id
      AND pm.user_id=$${startIndex + 1} AND pm.status='active')`, values: [[...scope.organizationIds], scope.actorId] };
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export class FileRepository implements FileRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findDeliverableAuthorized(deliverableId: string, scope: AuthorizedRepositoryScope): Promise<DeliverableFileContext | null> {
    const predicate = deliverablePredicate(scope, 2);
    const result = await this.pool.query<DeliverableRow>(`SELECT d.id,d.project_id,d.organization_id,d.delivery_party,
      d.due_date::text,d.status FROM deliverables d JOIN projects p ON p.id=d.project_id AND p.organization_id=d.organization_id
      WHERE d.id=$1 AND (${predicate.sql})`, [deliverableId, ...predicate.values]);
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, projectId: row.project_id, organizationId: row.organization_id,
      deliveryParty: row.delivery_party, dueDate: row.due_date, status: row.status };
  }

  async createPending(input: CreatePendingFileInput, audit: AuditContext): Promise<FileRecord> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<FileRow>(`WITH inserted AS (
        INSERT INTO files (organization_id,deliverable_id,uploaded_by_user_id,original_name,storage_provider,
          object_key,mime_type,size_bytes,checksum_sha256,classification,audience,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confidential','organization','pending_upload') RETURNING *
      ) SELECT inserted.id,inserted.organization_id,inserted.project_id,inserted.deliverable_id,
        inserted.uploaded_by_user_id,COALESCE(nullif(concat_ws(' ',u.first_name,u.last_name),''),u.primary_email) AS uploaded_by_name,
        inserted.original_name,inserted.storage_provider,inserted.object_key,inserted.mime_type,inserted.size_bytes::text,inserted.checksum_sha256,
        inserted.audience,inserted.status,inserted.created_at,d.delivery_party,d.status AS deliverable_status
      FROM inserted JOIN app_users u ON u.id=inserted.uploaded_by_user_id
      JOIN deliverables d ON d.id=inserted.deliverable_id AND d.organization_id=inserted.organization_id`,
      [input.organizationId,input.deliverableId,input.uploadedByUserId,input.originalName,input.storageProvider,
        input.objectKey,input.mimeType,input.sizeBytes,input.checksumSha256 ?? null]);
      const file = mapFile(result.rows[0]!);
      await insertAuditEvent(client, { ...audit, organizationId: input.organizationId, action: "file.upload_intent_created",
        entityType: "file", entityId: file.id, newValues: { deliverableId: input.deliverableId,
          originalName: input.originalName, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256 ?? null } });
      return file;
    });
  }

  async findAuthorizedById(fileId: string, scope: AuthorizedRepositoryScope, audiences: readonly FileAudience[]): Promise<FileRecord | null> {
    if (audiences.length === 0) return null;
    const predicate = scopePredicate(scope, 3);
    const result = await this.pool.query<FileRow>(`${FILE_SELECT} WHERE f.id=$1 AND f.audience=ANY($2::varchar[])
      AND f.deleted_at IS NULL AND (${predicate.sql})`, [fileId,[...audiences],...predicate.values]);
    return result.rows[0] === undefined ? null : mapFile(result.rows[0]);
  }

  async listByDeliverable(deliverableId: string, scope: AuthorizedRepositoryScope, audiences: readonly FileAudience[]): Promise<readonly FileRecord[] | null> {
    if (await this.findDeliverableAuthorized(deliverableId, scope) === null) return null;
    if (audiences.length === 0) return [];
    const predicate = scopePredicate(scope, 3);
    const result = await this.pool.query<FileRow>(`${FILE_SELECT} WHERE f.deliverable_id=$1
      AND f.audience=ANY($2::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql})
      ORDER BY f.created_at ASC,f.id ASC`, [deliverableId,[...audiences],...predicate.values]);
    return result.rows.map(mapFile);
  }

  private mutateStatus(fileId: string, scope: AuthorizedRepositoryScope, next: "active" | "quarantined" | "deleted", audit: AuditContext): Promise<FileWriteResult<FileRecord>> {
    return transaction(this.pool, async (client) => {
      const predicate = scopePredicate(scope, 2);
      const currentResult = await client.query<FileRow>(`${FILE_SELECT} WHERE f.id=$1 AND f.deleted_at IS NULL
        AND (${predicate.sql}) FOR UPDATE OF f`, [fileId,...predicate.values]);
      const currentRow = currentResult.rows[0];
      if (currentRow === undefined) return "not_found";
      const current = mapFile(currentRow);
      if (next === "active" && current.status === "active") return current;
      if (next === "deleted" && current.status === "deleted") return current;
      if (next === "active" && current.status !== "pending_upload") return "conflict";
      await client.query(`UPDATE files SET status=$2::varchar,
        deleted_at=CASE WHEN $2::varchar='deleted' THEN now() ELSE NULL END WHERE id=$1`, [fileId,next]);
      if (next === "active" && current.deliverableId !== null && current.deliverableParty === "client") {
        await client.query(`UPDATE deliverables SET status='in_review',updated_at=now()
          WHERE id=$1 AND status IN ('pending','rejected')`, [current.deliverableId]);
      }
      await insertAuditEvent(client, { ...audit, organizationId: current.organizationId,
        action: next === "active" ? "file.upload_completed" : next === "deleted" ? "file.deleted" : "file.quarantined",
        entityType: "file", entityId: fileId, oldValues: { status: current.status }, newValues: { status: next } });
      const updated = await client.query<FileRow>(`${FILE_SELECT} WHERE f.id=$1`, [fileId]);
      return mapFile(updated.rows[0]!);
    });
  }

  complete(fileId: string, scope: AuthorizedRepositoryScope, audit: AuditContext) { return this.mutateStatus(fileId,scope,"active",audit); }
  quarantine(fileId: string, scope: AuthorizedRepositoryScope, audit: AuditContext) { return this.mutateStatus(fileId,scope,"quarantined",audit); }
  markDeleted(fileId: string, scope: AuthorizedRepositoryScope, audit: AuditContext) { return this.mutateStatus(fileId,scope,"deleted",audit); }

  async countAuthorized(scope: AuthorizedRepositoryScope, audiences: readonly FileAudience[]): Promise<number> {
    const predicate=scopePredicate(scope,2); if(audiences.length===0)return 0;
    const result=await this.pool.query<{readonly count:string}>(`SELECT count(*)::text count FROM files f WHERE f.audience=ANY($1::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql})`,[[...audiences],...predicate.values]); return Number(result.rows[0]?.count??0);
  }
  async listAuthorized(scope: AuthorizedRepositoryScope,audiences:readonly FileAudience[],limit:number,offset:number){
    const predicate=scopePredicate(scope,4); if(audiences.length===0)return [];
    const result=await this.pool.query<FileRow>(`${FILE_SELECT} WHERE f.audience=ANY($1::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql}) ORDER BY f.created_at DESC,f.id DESC LIMIT $2 OFFSET $3`,[[...audiences],Math.min(Math.max(limit,1),100),Math.max(offset,0),...predicate.values]); return result.rows.map(mapFile);
  }
  async searchAuthorized(scope:AuthorizedRepositoryScope,audiences:readonly FileAudience[],term:string,limit=25){
    const predicate=scopePredicate(scope,4); if(audiences.length===0||term.trim()==="")return [];
    const escaped=term.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_");
    const result=await this.pool.query<FileRow>(`${FILE_SELECT} WHERE f.audience=ANY($1::varchar[]) AND f.original_name ILIKE $2 ESCAPE '\\' AND f.deleted_at IS NULL AND (${predicate.sql}) ORDER BY f.created_at DESC,f.id DESC LIMIT $3`,[[...audiences],`%${escaped}%`,Math.min(Math.max(limit,1),100),...predicate.values]); return result.rows.map(mapFile);
  }
  async aggregateByAudience(scope:AuthorizedRepositoryScope,audiences:readonly FileAudience[]):Promise<Readonly<Record<FileAudience,number>>>{
    const totals:Record<FileAudience,number>={internal:0,organization:0}; if(audiences.length===0)return totals;
    const predicate=scopePredicate(scope,2); const result=await this.pool.query<{readonly audience:FileAudience;readonly count:string}>(`SELECT f.audience,count(*)::text count FROM files f WHERE f.audience=ANY($1::varchar[]) AND f.deleted_at IS NULL AND (${predicate.sql}) GROUP BY f.audience`,[[...audiences],...predicate.values]); for(const row of result.rows)totals[row.audience]=Number(row.count); return totals;
  }
}
