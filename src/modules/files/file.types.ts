import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { DeliverableParty, DeliverableStatus } from "../projects/project.types.js";
import type { FileAudience, FileStatus } from "./file-authorization.js";

export interface DeliverableFileContext {
  readonly id: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly deliveryParty: DeliverableParty;
  readonly dueDate: string | null;
  readonly status: DeliverableStatus;
}
export interface FileRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly deliverableId: string | null;
  readonly uploadedByUserId: string;
  readonly uploadedByName: string;
  readonly originalName: string;
  readonly storageProvider: string;
  readonly objectKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string | null;
  readonly audience: FileAudience;
  readonly status: FileStatus;
  readonly createdAt: Date;
  readonly deliverableParty: DeliverableParty | null;
  readonly deliverableStatus: DeliverableStatus | null;
}
export type PublicFileRecord = Omit<FileRecord, "storageProvider" | "objectKey" | "deliverableParty" | "deliverableStatus">;
export interface CreatePendingFileInput {
  readonly organizationId: string;
  readonly deliverableId: string;
  readonly uploadedByUserId: string;
  readonly originalName: string;
  readonly storageProvider: string;
  readonly objectKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256?: string;
}
export type FileWriteResult<T> = T | "not_found" | "conflict";
export interface FileRepositoryPort {
  findDeliverableAuthorized(deliverableId: string, scope: AuthorizedRepositoryScope): Promise<DeliverableFileContext | null>;
  createPending(input: CreatePendingFileInput, audit: AuditContext): Promise<FileRecord>;
  findAuthorizedById(fileId: string, scope: AuthorizedRepositoryScope, audiences: readonly FileAudience[]): Promise<FileRecord | null>;
  listByDeliverable(deliverableId: string, scope: AuthorizedRepositoryScope, audiences: readonly FileAudience[]): Promise<readonly FileRecord[] | null>;
  complete(fileId: string, scope: AuthorizedRepositoryScope, audit: AuditContext): Promise<FileWriteResult<FileRecord>>;
  quarantine(fileId: string, scope: AuthorizedRepositoryScope, audit: AuditContext): Promise<FileWriteResult<FileRecord>>;
  markDeleted(fileId: string, scope: AuthorizedRepositoryScope, audit: AuditContext): Promise<FileWriteResult<FileRecord>>;
}
