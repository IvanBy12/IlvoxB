import type { ActorContext } from "../../common/auth/authorization.types.js";
import { defaultFilePolicy, type FileUploadMetadata } from "./file-policy.js";

export type { FileUploadMetadata } from "./file-policy.js";

export type FileAudience = "internal" | "organization";
export type FileStatus = "pending_upload" | "pending_scan" | "active" | "quarantined" | "deleted";

export interface FileAccessContext {
  readonly organizationId: string;
  readonly audience: FileAudience;
  readonly status: FileStatus;
  readonly resourceAccess: boolean;
  readonly direct: boolean;
}

export interface FilePolicyDecision {
  readonly allowed: boolean;
  readonly reason: "ALLOW" | "PERMISSION" | "ORGANIZATION" | "AUDIENCE" | "RESOURCE" | "STATUS" | "METADATA";
  readonly auditRequired: boolean;
}

function hasPermission(actor: ActorContext, code: string): boolean {
  return actor.permissions.some((permission) => permission.code === code);
}

function activeMembership(actor: ActorContext, organizationId: string): boolean {
  return actor.memberships.some((membership) => membership.organizationId === organizationId);
}

function allowed(): FilePolicyDecision { return { allowed: true, reason: "ALLOW", auditRequired: false }; }
function denied(reason: FilePolicyDecision["reason"]): FilePolicyDecision {
  return { allowed: false, reason, auditRequired: false };
}

export function validateFileUploadMetadata(metadata: FileUploadMetadata): FilePolicyDecision {
  return defaultFilePolicy.validateMetadata(metadata).allowed ? allowed() : denied("METADATA");
}

export function authorizeFileRead(actor: ActorContext, file: FileAccessContext): FilePolicyDecision {
  if (file.status !== "active") return denied("STATUS");
  if (!file.resourceAccess) return denied("RESOURCE");
  if (actor.internal) {
    if (!hasPermission(actor, "files.read")) return denied("PERMISSION");
    return allowed();
  }
  if (!hasPermission(actor, "files.read_client")) return denied("PERMISSION");
  if (!activeMembership(actor, file.organizationId)) return denied("ORGANIZATION");
  if (file.audience !== "organization") return denied("AUDIENCE");
  return allowed();
}

export function authorizeFileUpload(
  actor: ActorContext,
  file: Omit<FileAccessContext, "status">,
  metadata: FileUploadMetadata,
): FilePolicyDecision {
  const metadataDecision = validateFileUploadMetadata(metadata);
  if (!metadataDecision.allowed) return metadataDecision;
  if (!file.resourceAccess) return denied("RESOURCE");
  if (actor.internal) {
    if (!hasPermission(actor, "files.upload")) return denied("PERMISSION");
    return allowed();
  }
  if (!hasPermission(actor, "files.upload_client")) return denied("PERMISSION");
  if (!activeMembership(actor, file.organizationId)) return denied("ORGANIZATION");
  if (file.audience !== "organization") return denied("AUDIENCE");
  if (file.direct && !actor.roles.some((role) =>
    role.scope === "organization" && role.code === "client_manager" && role.organizationId === file.organizationId)) {
    return denied("RESOURCE");
  }
  return allowed();
}

export function authorizeAudienceChange(
  actor: ActorContext,
  file: FileAccessContext,
  nextAudience: FileAudience,
): FilePolicyDecision {
  if (!actor.internal || !hasPermission(actor, "files.upload")) return denied("PERMISSION");
  if (!file.resourceAccess) return denied("RESOURCE");
  if (file.audience === nextAudience) return allowed();
  return { allowed: true, reason: "ALLOW", auditRequired: true };
}
