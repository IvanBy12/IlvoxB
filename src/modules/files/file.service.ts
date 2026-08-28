import { randomUUID } from "node:crypto";
import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { authorizeFileRead, authorizeFileUpload, type FileAudience } from "./file-authorization.js";
import type { FilePolicy } from "./file-policy.js";
import type { FileUploadMetadata } from "./file-policy.js";
import type { FileRepositoryPort, FileRecord, PublicFileRecord } from "./file.types.js";
import type { FileStorage } from "./file-storage.js";

export interface FileServiceOptions { readonly uploadTtlSeconds: number; readonly downloadTtlSeconds: number; }

function publicFile(file: FileRecord): PublicFileRecord {
  return {
    id: file.id,
    organizationId: file.organizationId,
    projectId: file.projectId,
    deliverableId: file.deliverableId,
    uploadedByUserId: file.uploadedByUserId,
    uploadedByName: file.uploadedByName,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    checksumSha256: file.checksumSha256,
    audience: file.audience,
    status: file.status,
    createdAt: file.createdAt,
  };
}
function forbidden(message: string): AppError { return new AppError({ code: ErrorCode.Forbidden, message, statusCode: 403 }); }
function notFound(): AppError { return new AppError({ code: ErrorCode.NotFound, message: "Resource not found", statusCode: 404 }); }
function validation(message: string): AppError { return new AppError({ code: ErrorCode.ValidationError, message, statusCode: 400 }); }
function conflict(message: string): AppError { return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 }); }

export class FileService {
  constructor(
    private readonly repository: FileRepositoryPort,
    private readonly storage: FileStorage,
    private readonly authorization: AuthorizationService,
    private readonly policy: FilePolicy,
    private readonly options: FileServiceOptions,
  ) {}

  private action(actor: ActorContext, operation: "read" | "upload"): string {
    return actor.internal ? `files.${operation}` : `files.${operation}_client`;
  }
  private scope(actor: ActorContext, operation: "read" | "upload"): AuthorizedRepositoryScope {
    return this.authorization.assertAllowed({ actor, action: this.action(actor, operation), resourceType: "file" }).repositoryScope!;
  }
  private audiences(actor: ActorContext): readonly FileAudience[] { return actor.internal ? ["internal", "organization"] : ["organization"]; }

  async createUploadIntent(actor: ActorContext, input: { readonly deliverableId: string; readonly checksumSha256?: string } & FileUploadMetadata, audit: AuditContext) {
    const validated = this.policy.validateMetadata(input);
    if (!validated.allowed) throw validation(validated.message);
    const scope = this.scope(actor, "upload");
    const deliverable = await this.repository.findDeliverableAuthorized(input.deliverableId, scope);
    if (deliverable === null) throw notFound();
    if (["approved", "delivered"].includes(deliverable.status)) throw conflict("The deliverable no longer accepts files");
    if (!actor.internal && deliverable.deliveryParty !== "client") throw forbidden("This deliverable is not requesting a client upload");
    if (!actor.internal && !["pending", "rejected", "in_review"].includes(deliverable.status)) throw conflict("The deliverable no longer accepts client files");
    const decision = authorizeFileUpload(actor, { organizationId: deliverable.organizationId, audience: "organization", resourceAccess: true, direct: false }, validated.metadata);
    if (!decision.allowed) throw forbidden("File upload is not allowed");
    const objectKey = `organizations/${deliverable.organizationId}/deliverables/${deliverable.id}/${randomUUID()}`;
    const file = await this.repository.createPending({ organizationId: deliverable.organizationId,
      deliverableId: deliverable.id, uploadedByUserId: actor.localUserId, originalName: validated.metadata.originalName,
      storageProvider: "r2", objectKey, mimeType: validated.metadata.mimeType, sizeBytes: validated.metadata.sizeBytes,
      ...(input.checksumSha256 === undefined ? {} : { checksumSha256: input.checksumSha256.toLowerCase() }) }, audit);
    try {
      const signed = await this.storage.createUploadUrl(objectKey, file.mimeType, file.sizeBytes,
        this.options.uploadTtlSeconds, file.checksumSha256 ?? undefined);
      return { file: publicFile(file), upload: { method: "PUT" as const, ...signed } };
    } catch (error) {
      await this.repository.markDeleted(file.id, scope, audit).catch(() => undefined);
      throw error;
    }
  }

  async complete(actor: ActorContext, fileId: string, audit: AuditContext) {
    const scope = this.scope(actor, "upload");
    const file = await this.repository.findAuthorizedById(fileId, scope, this.audiences(actor));
    if (file === null) throw notFound();
    if (!actor.internal && file.uploadedByUserId !== actor.localUserId) throw notFound();
    if (file.status === "active") return publicFile(file);
    if (file.status !== "pending_upload") throw conflict("The upload cannot be completed in its current state");
    const stored = await this.storage.head(file.objectKey);
    if (stored === null) throw conflict("The uploaded object is not available yet");
    const declared = this.policy.validateMetadata({ originalName: file.originalName, mimeType: stored.mimeType ?? "", sizeBytes: stored.sizeBytes });
    const expected = this.policy.validateMetadata(file);
    const prefix = await this.storage.readPrefix(file.objectKey, 8_192);
    const invalid = !declared.allowed || !expected.allowed || stored.sizeBytes !== file.sizeBytes ||
      stored.mimeType?.toLowerCase() !== file.mimeType.toLowerCase() ||
      !this.policy.validateSignature(expected.allowed ? expected.metadata.extension : "", prefix);
    if (invalid) {
      await this.repository.quarantine(file.id, scope, audit);
      throw validation("El contenido almacenado no coincide con el formato, MIME o tamaño declarado.");
    }
    const completed = await this.repository.complete(file.id, scope, audit);
    if (completed === "not_found") throw notFound();
    if (completed === "conflict") throw conflict("The upload state changed concurrently");
    return publicFile(completed);
  }

  async listDeliverableFiles(actor: ActorContext, deliverableId: string) {
    const files = await this.repository.listByDeliverable(deliverableId, this.scope(actor, "read"), this.audiences(actor));
    if (files === null) throw notFound();
    return files.filter((file) => file.status === "active").map(publicFile);
  }

  async createDownloadUrl(actor: ActorContext, fileId: string) {
    const file = await this.repository.findAuthorizedById(fileId, this.scope(actor, "read"), this.audiences(actor));
    if (file === null) throw notFound();
    const decision = authorizeFileRead(actor, { organizationId: file.organizationId, audience: file.audience,
      status: file.status, resourceAccess: true, direct: false });
    if (!decision.allowed) throw notFound();
    const signed = await this.storage.createDownloadUrl(file.objectKey, file.originalName, this.options.downloadTtlSeconds);
    return { method: "GET" as const, url: signed.url, expiresAt: signed.expiresAt };
  }

  async delete(actor: ActorContext, fileId: string, audit: AuditContext): Promise<void> {
    const scope = this.scope(actor, "upload");
    const file = await this.repository.findAuthorizedById(fileId, scope, this.audiences(actor));
    if (file === null) throw notFound();
    if (!actor.internal) {
      if (file.uploadedByUserId !== actor.localUserId) throw notFound();
      if (file.status !== "pending_upload" || !["pending", "rejected", "in_review"].includes(file.deliverableStatus ?? "")) throw conflict("The submitted file can no longer be removed");
    } else if (["approved", "delivered"].includes(file.deliverableStatus ?? "")) {
      throw conflict("Files of a definitive deliverable cannot be removed");
    }
    await this.storage.delete(file.objectKey);
    const deleted = await this.repository.markDeleted(fileId, scope, audit);
    if (deleted === "not_found") throw notFound();
    if (deleted === "conflict") throw conflict("The file state changed concurrently");
  }
}
