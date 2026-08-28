import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../src/common/auth/authorization.types.js";
import { AppError } from "../../src/common/errors/app-error.js";
import { FilePolicy } from "../../src/modules/files/file-policy.js";
import { FileService } from "../../src/modules/files/file.service.js";
import { MemoryFileStorage } from "../../src/modules/files/file-storage.js";
import type {
  CreatePendingFileInput,
  DeliverableFileContext,
  FileRecord,
  FileRepositoryPort,
  FileWriteResult,
} from "../../src/modules/files/file.types.js";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const DELIVERABLE_A = "20000000-0000-4000-8000-000000000001";
const USER_INTERNAL = "30000000-0000-4000-8000-000000000001";
const USER_CLIENT_A = "30000000-0000-4000-8000-000000000002";
const USER_CLIENT_B = "30000000-0000-4000-8000-000000000003";
const audit = { requestId: "file-test" };

function actor(input: { readonly id: string; readonly internal: boolean; readonly organizationId?: string; readonly global?: boolean }): ActorContext {
  const suffix = input.internal ? "" : "_client";
  return {
    clerkUserId: `clerk_${input.id}`,
    localUserId: input.id,
    status: "active",
    internal: input.internal,
    memberships: input.organizationId === undefined ? [] : [{
      organizationId: input.organizationId,
      roleId: randomUUID(),
      roleCode: "client_manager",
      status: "active",
    }],
    roles: input.organizationId === undefined ? [] : [{
      roleId: randomUUID(),
      code: "client_manager",
      scope: "organization",
      organizationId: input.organizationId,
    }],
    permissions: ["read", "upload"].map((operation) => ({
      code: `files.${operation}${suffix}`,
      scopes: [input.global ? "global" as const : "organization" as const],
      ...(input.organizationId === undefined ? {} : {
        scopeOrganizationIds: { organization: [input.organizationId] },
      }),
    })),
  };
}

function scopeAllows(scope: AuthorizedRepositoryScope, organizationId: string): boolean {
  return scope.kind === "global" || (scope.kind !== "public" && scope.organizationIds.includes(organizationId));
}

class MemoryRepository implements FileRepositoryPort {
  readonly files = new Map<string, FileRecord>();
  readonly completeCalls = vi.fn();
  readonly deliverables = new Map<string, DeliverableFileContext>([[DELIVERABLE_A, {
    id: DELIVERABLE_A,
    projectId: "40000000-0000-4000-8000-000000000001",
    organizationId: ORG_A,
    deliveryParty: "client",
    dueDate: "2026-09-15",
    status: "pending",
  }]]);

  findDeliverableAuthorized(deliverableId: string, scope: AuthorizedRepositoryScope) {
    const deliverable = this.deliverables.get(deliverableId);
    return Promise.resolve(deliverable !== undefined && scopeAllows(scope, deliverable.organizationId) ? deliverable : null);
  }

  createPending(input: CreatePendingFileInput) {
    const deliverable = this.deliverables.get(input.deliverableId)!;
    const file: FileRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: deliverable.projectId,
      deliverableId: input.deliverableId,
      uploadedByUserId: input.uploadedByUserId,
      uploadedByName: "Test uploader",
      originalName: input.originalName,
      storageProvider: input.storageProvider,
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256 ?? null,
      audience: "organization",
      status: "pending_upload",
      createdAt: new Date(),
      deliverableParty: deliverable.deliveryParty,
      deliverableStatus: deliverable.status,
    };
    this.files.set(file.id, file);
    return Promise.resolve(file);
  }

  findAuthorizedById(fileId: string, scope: AuthorizedRepositoryScope) {
    const file = this.files.get(fileId);
    return Promise.resolve(file !== undefined && scopeAllows(scope, file.organizationId) ? file : null);
  }

  async listByDeliverable(deliverableId: string, scope: AuthorizedRepositoryScope) {
    const deliverable = await this.findDeliverableAuthorized(deliverableId, scope);
    return deliverable === null ? null : [...this.files.values()].filter((file) => file.deliverableId === deliverableId);
  }

  complete(fileId: string, scope: AuthorizedRepositoryScope): Promise<FileWriteResult<FileRecord>> {
    this.completeCalls();
    return this.mutate(fileId, scope, "active");
  }
  quarantine(fileId: string, scope: AuthorizedRepositoryScope) { return this.mutate(fileId, scope, "quarantined"); }
  markDeleted(fileId: string, scope: AuthorizedRepositoryScope) { return this.mutate(fileId, scope, "deleted"); }
  private mutate(fileId: string, scope: AuthorizedRepositoryScope, status: FileRecord["status"]): Promise<FileWriteResult<FileRecord>> {
    const current = this.files.get(fileId);
    if (current === undefined || !scopeAllows(scope, current.organizationId)) return Promise.resolve("not_found");
    const updated = { ...current, status };
    this.files.set(fileId, updated);
    return Promise.resolve(updated);
  }
}

function harness() {
  const repository = new MemoryRepository();
  const storage = new MemoryFileStorage();
  const service = new FileService(repository, storage, new AuthorizationService(), new FilePolicy(), {
    uploadTtlSeconds: 600,
    downloadTtlSeconds: 120,
  });
  return { repository, storage, service };
}

describe("central file policy", () => {
  it("accepts the approved formats and rejects executables, traversal, MIME spoofing and oversized files", () => {
    const policy = new FilePolicy();
    for (const sample of [
      ["a.pdf", "application/pdf"], ["a.csv", "text/csv"], ["a.xls", "application/vnd.ms-excel"],
      ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["a.zip", "application/zip"],
      ["a.doc", "application/msword"], ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"],
    ] as const) expect(policy.validateMetadata({ originalName: sample[0], mimeType: sample[1], sizeBytes: 100 }).allowed).toBe(true);
    expect(policy.validateMetadata({ originalName: "payload.exe", mimeType: "application/octet-stream", sizeBytes: 100 }).allowed).toBe(false);
    expect(policy.validateMetadata({ originalName: "../report.pdf", mimeType: "application/pdf", sizeBytes: 100 }).allowed).toBe(false);
    expect(policy.validateMetadata({ originalName: "report.pdf", mimeType: "text/html", sizeBytes: 100 }).allowed).toBe(false);
    expect(policy.validateMetadata({ originalName: "large.png", mimeType: "image/png", sizeBytes: 15 * 1024 * 1024 + 1 }).allowed).toBe(false);
  });
});

describe("file service upload and download flow", () => {
  const internal = actor({ id: USER_INTERNAL, internal: true, global: true });
  const clientA = actor({ id: USER_CLIENT_A, internal: false, organizationId: ORG_A });
  const clientB = actor({ id: USER_CLIENT_B, internal: false, organizationId: ORG_B });

  it("lets an authorized internal/super-admin create multiple intents without exposing object keys", async () => {
    const { service, repository } = harness();
    const checksumSha256 = "a".repeat(64);
    const first = await service.createUploadIntent(internal, { deliverableId: DELIVERABLE_A, originalName: "one.pdf", mimeType: "application/pdf", sizeBytes: 5, checksumSha256 }, audit);
    const second = await service.createUploadIntent(internal, { deliverableId: DELIVERABLE_A, originalName: "two.pdf", mimeType: "application/pdf", sizeBytes: 5 }, audit);
    expect(repository.files).toHaveLength(2);
    expect(first.file).not.toHaveProperty("objectKey");
    expect(first.file.checksumSha256).toBe(checksumSha256);
    expect(first.upload.headers).toHaveProperty("x-amz-checksum-sha256");
    expect(first.upload.url).not.toBe(second.upload.url);
  });

  it("rejects forbidden types and size before creating metadata", async () => {
    const { service, repository } = harness();
    await expect(service.createUploadIntent(internal, { deliverableId: DELIVERABLE_A, originalName: "bad.js", mimeType: "text/javascript", sizeBytes: 10 }, audit)).rejects.toBeInstanceOf(AppError);
    await expect(service.createUploadIntent(internal, { deliverableId: DELIVERABLE_A, originalName: "large.zip", mimeType: "application/zip", sizeBytes: 100 * 1024 * 1024 + 1 }, audit)).rejects.toBeInstanceOf(AppError);
    expect(repository.files).toHaveLength(0);
  });

  it("allows the same-organization client and hides a different tenant", async () => {
    const { service } = harness();
    await expect(service.createUploadIntent(clientA, { deliverableId: DELIVERABLE_A, originalName: "answer.csv", mimeType: "text/csv", sizeBytes: 3 }, audit)).resolves.toBeDefined();
    await expect(service.createUploadIntent(clientB, { deliverableId: DELIVERABLE_A, originalName: "answer.csv", mimeType: "text/csv", sizeBytes: 3 }, audit)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("completes idempotently, validates stored content and returns a temporary download URL", async () => {
    const { service, repository, storage } = harness();
    const intent = await service.createUploadIntent(clientA, { deliverableId: DELIVERABLE_A, originalName: "answer.pdf", mimeType: "application/pdf", sizeBytes: 5 }, audit);
    const stored = repository.files.get(intent.file.id)!;
    await storage.put(stored.objectKey, new TextEncoder().encode("%PDF-"), "application/pdf");
    await expect(service.complete(clientA, stored.id, audit)).resolves.toMatchObject({ status: "active" });
    await expect(service.complete(clientA, stored.id, audit)).resolves.toMatchObject({ status: "active" });
    expect(repository.completeCalls).toHaveBeenCalledTimes(1);
    const signed = await service.createDownloadUrl(clientA, stored.id);
    expect(signed.url).toContain("memory://download/");
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(service.createDownloadUrl(clientB, stored.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("quarantines an uploaded object whose signature does not match its declared type", async () => {
    const { service, repository, storage } = harness();
    const intent = await service.createUploadIntent(internal, { deliverableId: DELIVERABLE_A, originalName: "spoof.pdf", mimeType: "application/pdf", sizeBytes: 5 }, audit);
    const stored = repository.files.get(intent.file.id)!;
    await storage.put(stored.objectKey, new TextEncoder().encode("HELLO"), "application/pdf");
    await expect(service.complete(internal, stored.id, audit)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.files.get(stored.id)?.status).toBe("quarantined");
  });
});
