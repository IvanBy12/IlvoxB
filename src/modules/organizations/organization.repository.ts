import type { Pool, PoolClient } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type {
  OrganizationCreateInput,
  OrganizationDetail,
  OrganizationListInput,
  OrganizationMember,
  OrganizationMemberCreate,
  OrganizationMemberPatch,
  OrganizationPatch,
  OrganizationRecord,
  OrganizationRepository,
} from "./organization.types.js";

interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly legal_name: string | null;
  readonly industry: string | null;
  readonly size: OrganizationRecord["size"];
  readonly status: OrganizationRecord["status"];
  readonly country_code: string | null;
  readonly tax_id: string | null;
  readonly account_manager_user_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface MemberRow {
  readonly organization_id: string;
  readonly user_id: string;
  readonly primary_email: string;
  readonly display_name: string | null;
  readonly role_code: OrganizationMember["roleCode"];
  readonly status: OrganizationMember["status"];
  readonly job_title: string | null;
  readonly phone: string | null;
  readonly activated_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const ORGANIZATION_COLUMNS = `id, name, legal_name, industry, size, status, country_code,
  tax_id, account_manager_user_id, created_at, updated_at`;

function mapOrganization(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    industry: row.industry,
    size: row.size,
    status: row.status,
    countryCode: row.country_code,
    taxId: row.tax_id,
    accountManagerUserId: row.account_manager_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): OrganizationMember {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    primaryEmail: row.primary_email,
    displayName: row.display_name,
    roleCode: row.role_code,
    status: row.status,
    jobTitle: row.job_title,
    phone: row.phone,
    activatedAt: row.activated_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scopePredicate(
  scope: AuthorizedRepositoryScope,
  alias = "o",
  startAt = 1,
): { readonly sql: string; readonly values: unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public" || scope.organizationIds.length === 0) return { sql: "false", values: [] };
  return {
    sql: `${alias}.id = ANY($${startAt}::uuid[])`,
    values: [[...scope.organizationIds]],
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

function normalizedTaxId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

async function activeInternalUser(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM app_users u
     WHERE u.id = $1 AND u.status = 'active'
       AND EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.scope = 'global'
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id AND p.code = 'organizations.manage'
         WHERE ur.user_id = u.id
       )`,
    [userId],
  );
  return result.rowCount !== 0;
}

async function validLocalUser(
  client: PoolClient,
  userId: string,
  status: "pending" | "active",
): Promise<boolean> {
  const allowedStatuses = status === "active" ? ["active"] : ["pending", "active"];
  const result = await client.query(
    "SELECT 1 FROM app_users WHERE id = $1 AND status = ANY($2::varchar[])",
    [userId, allowedStatuses],
  );
  return result.rowCount !== 0;
}

export class PostgresOrganizationRepository implements OrganizationRepository {
  constructor(private readonly pool: Pool) {}

  async listAuthorized(scope: AuthorizedRepositoryScope, input: OrganizationListInput) {
    const scoped = scopePredicate(scope);
    const clauses = [scoped.sql];
    const values = [...scoped.values];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace("?", `$${values.length}`));
    };
    if (input.search !== undefined) {
      add("(o.name ILIKE '%' || ? || '%' OR o.legal_name ILIKE '%' || $VALUE || '%')", input.search);
      clauses[clauses.length - 1] = clauses[clauses.length - 1]!.replaceAll("$VALUE", `$${values.length}`);
    }
    if (input.status !== undefined) add("o.status = ?", input.status);
    if (input.createdFrom !== undefined) add("o.created_at >= ?", input.createdFrom);
    if (input.createdTo !== undefined) add("o.created_at <= ?", input.createdTo);
    const where = clauses.join(" AND ");
    const count = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM organizations o WHERE ${where}`,
      values,
    );
    const rows = await this.pool.query<OrganizationRow>(
      `SELECT ${ORGANIZATION_COLUMNS}
       FROM organizations o WHERE ${where}
       ORDER BY o.name ASC, o.id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.pageSize, paginationOffset(input)],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return { items: rows.rows.map(mapOrganization), pagination: paginationMeta(input, total) };
  }

  async findAuthorized(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
  ): Promise<OrganizationDetail | null> {
    const scoped = scopePredicate(scope, "o", 2);
    const result = await this.pool.query<OrganizationRow & {
      readonly member_count: string;
      readonly converted_lead_count: string;
    }>(
      `SELECT ${ORGANIZATION_COLUMNS},
         (SELECT count(*)::text FROM organization_memberships om
          WHERE om.organization_id = o.id AND om.status <> 'revoked') AS member_count,
         (SELECT count(*)::text FROM leads l
          WHERE l.converted_organization_id = o.id) AS converted_lead_count
       FROM organizations o
       WHERE o.id = $1 AND ${scoped.sql}`,
      [organizationId, ...scoped.values],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      ...mapOrganization(row),
      memberCount: Number(row.member_count),
      convertedLeadCount: Number(row.converted_lead_count),
    };
  }

  create(input: OrganizationCreateInput, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      if (input.accountManagerUserId !== undefined &&
          !await activeInternalUser(client, input.accountManagerUserId)) {
        return "ineligible_manager" as const;
      }
      try {
        const result = await client.query<OrganizationRow>(
          `INSERT INTO organizations (
             name, legal_name, industry, size, status, country_code,
             tax_id, tax_id_normalized, account_manager_user_id
           ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)
           RETURNING ${ORGANIZATION_COLUMNS}`,
          [
            input.name,
            input.legalName ?? null,
            input.industry ?? null,
            input.size ?? null,
            input.countryCode ?? null,
            input.taxId ?? null,
            normalizedTaxId(input.taxId),
            input.accountManagerUserId ?? null,
          ],
        );
        const organization = mapOrganization(result.rows[0]!);
        await insertAuditEvent(client, {
          ...audit,
          organizationId: organization.id,
          action: "organization.created",
          entityType: "organization",
          entityId: organization.id,
          newValues: { name: organization.name, status: organization.status },
        });
        return organization;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  updateAuthorized(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    input: OrganizationPatch,
    audit: AuditContext,
  ) {
    return transaction(this.pool, async (client) => {
      const scoped = scopePredicate(scope, "o", 2);
      const currentResult = await client.query<OrganizationRow>(
        `SELECT ${ORGANIZATION_COLUMNS} FROM organizations o
         WHERE o.id = $1 AND ${scoped.sql} FOR UPDATE`,
        [organizationId, ...scoped.values],
      );
      const currentRow = currentResult.rows[0];
      if (currentRow === undefined) return null;
      const current = mapOrganization(currentRow);
      if (input.accountManagerUserId !== undefined && input.accountManagerUserId !== null &&
          !await activeInternalUser(client, input.accountManagerUserId)) {
        return "ineligible_manager" as const;
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };
      if (input.name !== undefined) set("name", input.name);
      if (input.legalName !== undefined) set("legal_name", input.legalName);
      if (input.industry !== undefined) set("industry", input.industry);
      if (input.size !== undefined) set("size", input.size);
      if (input.status !== undefined) set("status", input.status);
      if (input.countryCode !== undefined) set("country_code", input.countryCode);
      if (input.taxId !== undefined) {
        set("tax_id", input.taxId);
        set("tax_id_normalized", normalizedTaxId(input.taxId));
      }
      if (input.accountManagerUserId !== undefined) set("account_manager_user_id", input.accountManagerUserId);
      if (fields.length === 0) return current;
      values.push(organizationId);
      try {
        const updated = await client.query<OrganizationRow>(
          `UPDATE organizations SET ${fields.join(", ")}, updated_at = now()
           WHERE id = $${values.length} RETURNING ${ORGANIZATION_COLUMNS}`,
          values,
        );
        const organization = mapOrganization(updated.rows[0]!);
        const changed = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
        await insertAuditEvent(client, {
          ...audit,
          organizationId,
          action: "organization.updated",
          entityType: "organization",
          entityId: organizationId,
          oldValues: Object.fromEntries(Object.keys(changed).map((key) => [key, current[key as keyof OrganizationRecord]])),
          newValues: changed,
        });
        return organization;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  async listMembers(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
  ): Promise<readonly OrganizationMember[] | null> {
    const scoped = scopePredicate(scope, "o", 2);
    const organization = await this.pool.query(
      `SELECT 1 FROM organizations o WHERE o.id = $1 AND ${scoped.sql}`,
      [organizationId, ...scoped.values],
    );
    if (organization.rowCount === 0) return null;
    const result = await this.pool.query<MemberRow>(
      `SELECT om.organization_id, om.user_id, u.primary_email,
         nullif(concat_ws(' ', u.first_name, u.last_name), '') AS display_name,
         r.code AS role_code, om.status, om.job_title, om.phone,
         om.activated_at, om.revoked_at, om.created_at, om.updated_at
       FROM organization_memberships om
       JOIN app_users u ON u.id = om.user_id
       JOIN roles r ON r.id = om.role_id AND r.scope = 'organization'
       WHERE om.organization_id = $1
       ORDER BY om.created_at ASC, om.user_id ASC`,
      [organizationId],
    );
    return result.rows.map(mapMember);
  }

  createMember(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    input: OrganizationMemberCreate,
    audit: AuditContext,
  ) {
    return transaction(this.pool, async (client) => {
      if (!await this.organizationExists(client, scope, organizationId)) return null;
      if (!await validLocalUser(client, input.userId, input.status)) return "ineligible_user" as const;
      const role = await client.query<{ readonly id: string }>(
        "SELECT id FROM roles WHERE scope = 'organization' AND code = $1",
        [input.roleCode],
      );
      try {
        await client.query(
          `INSERT INTO organization_memberships (
             organization_id, user_id, role_id, role_scope, status, job_title, phone,
             activated_at, revoked_at
           ) VALUES ($1, $2, $3, 'organization', $4::varchar, $5, $6,
             CASE WHEN $4::varchar = 'active' THEN now() ELSE NULL END, NULL)`,
          [
            organizationId,
            input.userId,
            role.rows[0]!.id,
            input.status,
            input.jobTitle ?? null,
            input.phone ?? null,
          ],
        );
        await insertAuditEvent(client, {
          ...audit,
          organizationId,
          action: "organization_membership.created",
          entityType: "organization_membership",
          newValues: { userId: input.userId, roleCode: input.roleCode, status: input.status },
        });
        return (await this.findMember(client, organizationId, input.userId))!;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  updateMember(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    userId: string,
    input: OrganizationMemberPatch,
    audit: AuditContext,
  ) {
    return transaction(this.pool, async (client) => {
      if (!await this.organizationExists(client, scope, organizationId)) return null;
      const existing = await client.query<MemberRow>(
        `SELECT om.organization_id, om.user_id, u.primary_email,
           nullif(concat_ws(' ', u.first_name, u.last_name), '') AS display_name,
           r.code AS role_code, om.status, om.job_title, om.phone,
           om.activated_at, om.revoked_at, om.created_at, om.updated_at
         FROM organization_memberships om
         JOIN app_users u ON u.id = om.user_id
         JOIN roles r ON r.id = om.role_id AND r.scope = 'organization'
         WHERE om.organization_id = $1 AND om.user_id = $2
         FOR UPDATE OF om`,
        [organizationId, userId],
      );
      if (existing.rows[0] === undefined) return null;
      if (input.status === "active" && !await validLocalUser(client, userId, "active")) {
        return "ineligible_user" as const;
      }
      let roleId: string | undefined;
      if (input.roleCode !== undefined) {
        const role = await client.query<{ readonly id: string }>(
          "SELECT id FROM roles WHERE scope = 'organization' AND code = $1",
          [input.roleCode],
        );
        roleId = role.rows[0]!.id;
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };
      if (roleId !== undefined) set("role_id", roleId);
      if (input.status !== undefined) {
        set("status", input.status);
        if (input.status === "active") {
          fields.push("activated_at = COALESCE(activated_at, now())", "revoked_at = NULL");
        } else if (input.status === "pending") {
          fields.push("activated_at = NULL", "revoked_at = NULL");
        } else {
          fields.push("revoked_at = now()");
        }
      }
      if (input.jobTitle !== undefined) set("job_title", input.jobTitle);
      if (input.phone !== undefined) set("phone", input.phone);
      if (fields.length === 0) return mapMember(existing.rows[0]);
      values.push(organizationId, userId);
      await client.query(
        `UPDATE organization_memberships
         SET ${fields.join(", ")}, updated_at = now()
         WHERE organization_id = $${values.length - 1} AND user_id = $${values.length}`,
        values,
      );
      const changed = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      await insertAuditEvent(client, {
        ...audit,
        organizationId,
        action: input.status === "revoked"
          ? "organization_membership.revoked"
          : "organization_membership.updated",
        entityType: "organization_membership",
        newValues: { userId, ...changed },
      });
      return this.findMember(client, organizationId, userId);
    });
  }

  private async organizationExists(
    client: PoolClient,
    scope: AuthorizedRepositoryScope,
    organizationId: string,
  ): Promise<boolean> {
    const scoped = scopePredicate(scope, "o", 2);
    const result = await client.query(
      `SELECT 1 FROM organizations o WHERE o.id = $1 AND ${scoped.sql} FOR UPDATE`,
      [organizationId, ...scoped.values],
    );
    return result.rowCount !== 0;
  }

  private async findMember(
    client: PoolClient,
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    const result = await client.query<MemberRow>(
      `SELECT om.organization_id, om.user_id, u.primary_email,
         nullif(concat_ws(' ', u.first_name, u.last_name), '') AS display_name,
         r.code AS role_code, om.status, om.job_title, om.phone,
         om.activated_at, om.revoked_at, om.created_at, om.updated_at
       FROM organization_memberships om
       JOIN app_users u ON u.id = om.user_id
       JOIN roles r ON r.id = om.role_id AND r.scope = 'organization'
       WHERE om.organization_id = $1 AND om.user_id = $2`,
      [organizationId, userId],
    );
    return result.rows[0] === undefined ? null : mapMember(result.rows[0]);
  }
}
