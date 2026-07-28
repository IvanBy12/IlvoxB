import type { Pool } from "pg";
import type {
  AccessScope,
  PermissionContext,
  RoleContext,
} from "../../common/auth/authorization.types.js";
import type { IdentityRepository, LocalIdentityProfile } from "./identity.types.js";

interface UserRow {
  readonly id: string;
  readonly clerk_user_id: string;
  readonly primary_email: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly avatar_url: string | null;
  readonly status: "pending" | "active" | "blocked" | "deleted";
}

interface EffectiveRoleRow {
  readonly role_id: string;
  readonly role_code: string;
  readonly role_scope: "global" | "organization" | "project";
  readonly organization_id: string | null;
  readonly project_id: string | null;
  readonly permission_code: string;
}

function scopesFor(row: EffectiveRoleRow): readonly AccessScope[] {
  if (row.permission_code === "services.read") return row.role_scope === "global" ? ["global", "public"] : ["public"];
  if (row.role_scope === "global") {
    if (!row.permission_code.startsWith("tickets.") &&
        !row.permission_code.startsWith("ticket_comments.")) return ["global"];
    if (["super_admin", "admin", "support_agent"].includes(row.role_code)) return ["global"];
    if (["project_lead", "contributor"].includes(row.role_code)) return ["assigned"];
    return ["own"];
  }
  if (row.role_scope === "organization") {
    return row.role_code === "client_contact" ? ["own", "assigned"] : ["organization"];
  }
  return ["assigned"];
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: Pool) {}

  async findByClerkUserId(clerkUserId: string): Promise<LocalIdentityProfile | null> {
    const userResult = await this.pool.query<UserRow>(
      `SELECT id, clerk_user_id, primary_email, first_name, last_name, avatar_url, status
       FROM app_users WHERE clerk_user_id = $1`,
      [clerkUserId],
    );
    const user = userResult.rows[0];
    if (user === undefined) return null;

    const roleResult = await this.pool.query<EffectiveRoleRow>(
      `WITH effective_roles AS (
         SELECT ur.role_id, r.code AS role_code, r.scope AS role_scope,
                NULL::uuid AS organization_id, NULL::uuid AS project_id
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND r.scope = 'global'
         UNION ALL
         SELECT om.role_id, r.code, r.scope, om.organization_id, NULL::uuid
         FROM organization_memberships om
         JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
         JOIN roles r ON r.id = om.role_id
         WHERE om.user_id = $1 AND om.status = 'active' AND r.scope = 'organization'
         UNION ALL
         SELECT pm.role_id, r.code, r.scope, pm.organization_id, pm.project_id
         FROM project_members pm
         JOIN projects pr ON pr.id = pm.project_id AND pr.organization_id = pm.organization_id
         JOIN roles r ON r.id = pm.role_id
         WHERE pm.user_id = $1 AND pm.status = 'active' AND r.scope = 'project'
       )
       SELECT er.role_id, er.role_code, er.role_scope, er.organization_id, er.project_id,
              p.code AS permission_code
       FROM effective_roles er
       JOIN role_permissions rp ON rp.role_id = er.role_id
       JOIN permissions p ON p.id = rp.permission_id
       ORDER BY er.role_scope, er.role_code, p.code`,
      [user.id],
    );

    const roleMap = new Map<string, RoleContext>();
    const permissionMap = new Map<string, {
      readonly scopes: Set<AccessScope>;
      readonly scopeOrganizations: Map<AccessScope, Set<string>>;
    }>();
    for (const row of roleResult.rows) {
      const roleKey = `${row.role_id}:${row.organization_id ?? ""}:${row.project_id ?? ""}`;
      roleMap.set(roleKey, {
        roleId: row.role_id,
        code: row.role_code,
        scope: row.role_scope,
        ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
      });
      const grant = permissionMap.get(row.permission_code) ?? {
        scopes: new Set<AccessScope>(), scopeOrganizations: new Map<AccessScope, Set<string>>(),
      };
      for (const scope of scopesFor(row)) {
        grant.scopes.add(scope);
        if (row.organization_id !== null && scope !== "global" && scope !== "public") {
          const organizations = grant.scopeOrganizations.get(scope) ?? new Set<string>();
          organizations.add(row.organization_id);
          grant.scopeOrganizations.set(scope, organizations);
        }
      }
      permissionMap.set(row.permission_code, grant);
    }

    const roles = [...roleMap.values()];
    const memberships = roles
      .filter((role): role is RoleContext & { organizationId: string } =>
        role.scope === "organization" && role.organizationId !== undefined)
      .map((role) => ({
        organizationId: role.organizationId,
        roleId: role.roleId,
        roleCode: role.code,
        status: "active" as const,
      }));
    const permissions: PermissionContext[] = [...permissionMap.entries()].map(([code, grant]) => ({
      code,
      scopes: [...grant.scopes],
      scopeOrganizationIds: Object.fromEntries(
        [...grant.scopeOrganizations].map(([scope, organizationIds]) => [scope, [...organizationIds]]),
      ),
    }));

    return {
      actor: {
        clerkUserId: user.clerk_user_id,
        localUserId: user.id,
        status: user.status,
        internal: roles.some((role) => role.scope === "global"),
        memberships,
        roles,
        permissions,
      },
      primaryEmail: user.primary_email,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
    };
  }
}
