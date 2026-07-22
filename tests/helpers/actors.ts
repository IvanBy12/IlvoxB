import type { ActorContext, PermissionContext } from "../../src/common/auth/authorization.types.js";

export const USER_A = "00000000-0000-4000-8000-000000000001";
export const USER_B = "00000000-0000-4000-8000-000000000002";
export const ORG_A = "00000000-0000-4000-8000-000000000101";
export const ORG_B = "00000000-0000-4000-8000-000000000102";

export function actor(options: {
  readonly internal?: boolean;
  readonly status?: ActorContext["status"];
  readonly permissions?: readonly PermissionContext[];
  readonly organizations?: readonly string[];
  readonly roleCode?: string;
  readonly localUserId?: string;
} = {}): ActorContext {
  const internal = options.internal ?? false;
  const roleCode = options.roleCode ?? (internal ? "admin" : "client_contact");
  const organizations = options.organizations ?? [ORG_A];
  return {
    clerkUserId: `clerk_${options.localUserId ?? USER_A}`,
    localUserId: options.localUserId ?? USER_A,
    status: options.status ?? "active",
    internal,
    memberships: organizations.map((organizationId, index) => ({
      organizationId,
      roleId: `00000000-0000-4000-8000-${String(index + 201).padStart(12, "0")}`,
      roleCode,
      status: "active" as const,
    })),
    roles: internal
      ? [{ roleId: "00000000-0000-4000-8000-000000000301", code: roleCode, scope: "global" }]
      : organizations.map((organizationId, index) => ({
          roleId: `00000000-0000-4000-8000-${String(index + 201).padStart(12, "0")}`,
          code: roleCode,
          scope: "organization" as const,
          organizationId,
        })),
    permissions: options.permissions ?? [],
  };
}
