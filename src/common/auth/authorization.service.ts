import { AppError } from "../errors/app-error.js";
import { ErrorCode } from "../errors/error-codes.js";
import type {
  AccessScope,
  ActorContext,
  AuthorizationDecision,
  AuthorizationReasonCode,
  AuthorizationRequest,
  AuthorizedRepositoryScope,
} from "./authorization.types.js";

const SENSITIVE_ACTIONS = new Set([
  "permissions.manage",
  "roles.assign_super_admin",
  "security.manage",
  "system.configure",
  "organizations.access_all",
]);

const TICKET_STATE_RULES: Readonly<Record<string, string>> = {
  "tickets.confirm_resolution": "resolved",
  "tickets.reject_resolution": "resolved",
  "tickets.request_reopen": "closed",
};

function denied(reasonCode: AuthorizationReasonCode, action: string): AuthorizationDecision {
  return { allowed: false, reasonCode, auditRequired: SENSITIVE_ACTIONS.has(action) };
}

function hasRole(actor: ActorContext, scope: "global" | "organization", code: string): boolean {
  return actor.roles.some((role) => role.scope === scope && role.code === code);
}

export class AuthorizationService {
  can(request: AuthorizationRequest): AuthorizationDecision {
    if (request.actor.status !== "active") return denied("ACTOR_INACTIVE", request.action);

    const permission = request.actor.permissions.find((item) => item.code === request.action);
    if (permission === undefined) return denied("PERMISSION_DENIED", request.action);

    if (request.requestedRole?.scope === "global" && request.requestedRole.code === "super_admin") {
      if (request.action !== "roles.assign_super_admin" || !hasRole(request.actor, "global", "super_admin")) {
        return denied("PRIVILEGE_BOUNDARY", request.action);
      }
      if (request.resourceId === request.actor.localUserId) return denied("PRIVILEGE_BOUNDARY", request.action);
    }
    if (request.action === "organization_members.manage" && request.requestedRole !== undefined &&
        (request.requestedRole.scope !== "organization" ||
         !["client_manager", "client_contact"].includes(request.requestedRole.code))) {
      return denied("PRIVILEGE_BOUNDARY", request.action);
    }
    if (request.action === "users.manage_non_privileged" && request.resourceId === request.actor.localUserId) {
      return denied("PRIVILEGE_BOUNDARY", request.action);
    }

    const requiredState = TICKET_STATE_RULES[request.action];
    if (requiredState !== undefined && request.resourceState !== requiredState) {
      return denied("RESOURCE_STATE_INVALID", request.action);
    }

    const resolved = this.resolveScope(request, permission.scopes);
    if (resolved === undefined) return denied("SCOPE_MISMATCH", request.action);

    if (request.resourceOwnerId !== undefined && resolved.kind === "own" &&
        request.resourceOwnerId !== request.actor.localUserId) {
      return denied("RESOURCE_NOT_AUTHORIZED", request.action);
    }
    if (request.resourceAssigneeIds !== undefined && resolved.kind === "assigned" &&
        !request.resourceAssigneeIds.includes(request.actor.localUserId)) {
      return denied("RESOURCE_NOT_AUTHORIZED", request.action);
    }

    return {
      allowed: true,
      reasonCode: "ALLOW",
      appliedScope: resolved.kind,
      repositoryScope: resolved,
      auditRequired: SENSITIVE_ACTIONS.has(request.action) || request.action.startsWith("tickets."),
    };
  }

  assertAllowed(request: AuthorizationRequest): AuthorizationDecision {
    const decision = this.can(request);
    if (decision.allowed) return decision;
    const hideExistence = decision.reasonCode === "ORGANIZATION_MISMATCH" ||
      decision.reasonCode === "RESOURCE_NOT_AUTHORIZED";
    throw new AppError({
      code: hideExistence ? ErrorCode.NotFound : ErrorCode.Forbidden,
      message: hideExistence ? "Resource not found" : "Operation is not allowed",
      statusCode: hideExistence ? 404 : 403,
    });
  }

  resolveScope(
    request: AuthorizationRequest,
    allowedScopes?: readonly AccessScope[],
  ): AuthorizedRepositoryScope | undefined {
    const permission = request.actor.permissions.find((item) => item.code === request.action);
    const scopes = allowedScopes ?? permission?.scopes;
    if (scopes === undefined || scopes.length === 0) return undefined;
    const requested = request.requestedScope;
    const candidates = requested === undefined ? scopes : scopes.filter((scope) => scope === requested);

    for (const scope of candidates) {
      if (scope === "global") {
        const isCrossOrganization = request.organizationId !== undefined &&
          !request.actor.memberships.some((membership) => membership.organizationId === request.organizationId);
        if (isCrossOrganization && !request.actor.permissions.some((item) =>
          item.code === "organizations.access_all" && item.scopes.includes("global"))) continue;
        return { kind: "global", actorId: request.actor.localUserId, crossOrganization: true };
      }
      if (scope === "public") return { kind: "public", actorId: request.actor.localUserId };

      const organizationIds = permission?.scopeOrganizationIds?.[scope] ??
        request.actor.memberships.map((membership) => membership.organizationId);
      if (request.organizationId !== undefined && !organizationIds.includes(request.organizationId)) continue;
      const selected = request.organizationId === undefined ? organizationIds : [request.organizationId];
      if (selected.length === 0 && scope === "organization") continue;
      return { kind: scope, actorId: request.actor.localUserId, organizationIds: selected };
    }
    return undefined;
  }
}
