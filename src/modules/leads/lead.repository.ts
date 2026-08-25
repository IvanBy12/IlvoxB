import type { Pool, PoolClient } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type {
  LeadCommercialPatch,
  LeadConversionInput,
  LeadDetail,
  LeadDiagnosticDetail,
  LeadHistoryEntry,
  LeadListInput,
  LeadRecord,
  LeadRepository,
  PublicLeadInput,
} from "./lead.types.js";

interface LeadRow {
  readonly id: string;
  readonly full_name: string;
  readonly company_name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly service_id: string | null;
  readonly service_name: string | null;
  readonly message: string;
  readonly source: LeadRecord["source"];
  readonly status: LeadRecord["status"];
  readonly assigned_to_user_id: string | null;
  readonly assigned_to_name: string | null;
  readonly converted_organization_id: string | null;
  readonly converted_organization_name: string | null;
  readonly converted_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const LEAD_SELECT = `SELECT l.id, l.full_name, l.company_name, l.email, l.phone,
  l.service_id, s.name AS service_name, l.message, l.source, l.status,
  l.assigned_to_user_id,
  nullif(concat_ws(' ', au.first_name, au.last_name), '') AS assigned_to_name,
  l.converted_organization_id, o.name AS converted_organization_name,
  l.converted_at, l.created_at, l.updated_at
  FROM leads l
  LEFT JOIN services s ON s.id = l.service_id
  LEFT JOIN app_users au ON au.id = l.assigned_to_user_id
  LEFT JOIN organizations o ON o.id = l.converted_organization_id`;

function mapLead(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    companyName: row.company_name,
    email: row.email,
    phone: row.phone,
    serviceId: row.service_id,
    serviceName: row.service_name,
    message: row.message,
    source: row.source,
    status: row.status,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    convertedOrganizationId: row.converted_organization_id,
    convertedOrganizationName: row.converted_organization_name,
    convertedAt: row.converted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function leadScope(scope: AuthorizedRepositoryScope, startAt = 1): {
  readonly sql: string;
  readonly values: unknown[];
} {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "assigned") {
    return { sql: `l.assigned_to_user_id = $${startAt}`, values: [scope.actorId] };
  }
  return { sql: "false", values: [] };
}

function organizationScope(
  scope: AuthorizedRepositoryScope,
  alias: string,
  startAt = 1,
): { readonly sql: string; readonly values: unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public" || scope.organizationIds.length === 0) return { sql: "false", values: [] };
  return {
    sql: `${alias}.id = ANY($${startAt}::uuid[])`,
    values: [[...scope.organizationIds]],
  };
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
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

function normalizeTaxId(value: string): string {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export class PostgresLeadRepository implements LeadRepository {
  constructor(private readonly pool: Pool) {}

  createPublic(input: PublicLeadInput, audit: AuditContext): Promise<LeadRecord> {
    return withTransaction(this.pool, async (client) => {
      if (input.serviceId !== undefined) {
        const service = await client.query(
          "SELECT 1 FROM services WHERE id = $1 AND is_public = true AND is_active = true",
          [input.serviceId],
        );
        if (service.rowCount === 0) throw Object.assign(new Error("service_not_found"), { code: "ILVOX_SERVICE_NOT_FOUND" });
      }
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO leads (
           full_name, company_name, email, phone, service_id, message, source,
           status, assigned_to_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', NULL)
         RETURNING id`,
        [
          input.fullName,
          input.companyName ?? null,
          input.email,
          input.phone ?? null,
          input.serviceId ?? null,
          input.message,
          input.source,
        ],
      );
      const leadId = inserted.rows[0]!.id;
      if (input.diagnosticId !== undefined) {
        const diagnostic = await client.query<{
          readonly lead_id: string | null;
          readonly expires_at: Date;
        }>(
          `SELECT lead_id, expires_at FROM diagnostic_runs WHERE id = $1 FOR UPDATE`,
          [input.diagnosticId],
        );
        const run = diagnostic.rows[0];
        if (run === undefined) {
          throw Object.assign(new Error("diagnostic_not_found"), { code: "ILVOX_DIAGNOSTIC_NOT_FOUND" });
        }
        if (run.expires_at.getTime() <= Date.now()) {
          throw Object.assign(new Error("diagnostic_expired"), { code: "ILVOX_DIAGNOSTIC_EXPIRED" });
        }
        if (run.lead_id !== null) {
          throw Object.assign(new Error("diagnostic_claimed"), { code: "ILVOX_DIAGNOSTIC_CLAIMED" });
        }
        const claimed = await client.query(
          "UPDATE diagnostic_runs SET lead_id = $1 WHERE id = $2 AND lead_id IS NULL",
          [leadId, input.diagnosticId],
        );
        if (claimed.rowCount !== 1) {
          throw Object.assign(new Error("diagnostic_claimed"), { code: "ILVOX_DIAGNOSTIC_CLAIMED" });
        }
      }
      await insertAuditEvent(client, {
        ...audit,
        action: "lead.public_created",
        entityType: "lead",
        entityId: leadId,
        newValues: {
          source: input.source,
          serviceId: input.serviceId ?? null,
          diagnosticId: input.diagnosticId ?? null,
          status: "new",
        },
      });
      return (await this.selectOne(client, leadId, { sql: "true", values: [] }))!;
    });
  }

  async listAuthorized(scope: AuthorizedRepositoryScope, input: LeadListInput) {
    const scoped = leadScope(scope);
    const clauses = [scoped.sql];
    const values = [...scoped.values];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace("?", `$${values.length}`));
    };
    if (input.search !== undefined) {
      add("(l.full_name ILIKE '%' || ? || '%' OR l.company_name ILIKE '%' || $VALUE || '%' OR l.email ILIKE '%' || $VALUE || '%')", input.search);
      const parameter = `$${values.length}`;
      clauses[clauses.length - 1] = clauses[clauses.length - 1]!.replaceAll("$VALUE", parameter);
    }
    if (input.status !== undefined) add("l.status = ?", input.status);
    if (input.serviceId !== undefined) add("l.service_id = ?", input.serviceId);
    if (input.assignedToUserId !== undefined) add("l.assigned_to_user_id = ?", input.assignedToUserId);
    if (input.createdFrom !== undefined) add("l.created_at >= ?", input.createdFrom);
    if (input.createdTo !== undefined) add("l.created_at <= ?", input.createdTo);
    const where = clauses.join(" AND ");
    const count = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM leads l WHERE ${where}`,
      values,
    );
    const sortColumn = input.sortBy === "updatedAt" ? "l.updated_at" : "l.created_at";
    const direction = input.sortDirection === "asc" ? "ASC" : "DESC";
    const rows = await this.pool.query<LeadRow>(
      `${LEAD_SELECT} WHERE ${where}
       ORDER BY ${sortColumn} ${direction}, l.id ${direction}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.pageSize, paginationOffset(input)],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return { items: rows.rows.map(mapLead), pagination: paginationMeta(input, total) };
  }

  async findAuthorized(scope: AuthorizedRepositoryScope, leadId: string): Promise<LeadDetail | null> {
    const scoped = leadScope(scope, 2);
    const lead = await this.selectOne(this.pool, leadId, scoped);
    if (lead === null) return null;
    const history = await this.pool.query<{
      readonly action: string;
      readonly old_values: Readonly<Record<string, unknown>> | null;
      readonly new_values: Readonly<Record<string, unknown>> | null;
      readonly created_at: Date;
    }>(
      `SELECT action, old_values, new_values, created_at
       FROM audit_events
       WHERE entity_type = 'lead' AND entity_id = $1
       ORDER BY created_at ASC, id ASC`,
      [leadId],
    );
    const entries: LeadHistoryEntry[] = history.rows.map((row) => ({
      action: row.action,
      oldValues: row.old_values,
      newValues: row.new_values,
      createdAt: row.created_at,
    }));
    return { ...lead, history: entries };
  }

  async findDiagnosticAuthorized(
    scope: AuthorizedRepositoryScope,
    leadId: string,
  ): Promise<LeadDiagnosticDetail | null> {
    const scoped = leadScope(scope, 2);
    const result = await this.pool.query<{
      readonly id: string;
      readonly completed_at: Date;
      readonly expires_at: Date;
      readonly result_snapshot: LeadDiagnosticDetail["resultSnapshot"];
    }>(
      `SELECT d.id, d.completed_at, d.expires_at, d.result_snapshot
       FROM diagnostic_runs d JOIN leads l ON l.id = d.lead_id
       WHERE l.id = $1 AND ${scoped.sql}`,
      [leadId, ...scoped.values],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      id: row.id,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      resultSnapshot: row.result_snapshot,
    };
  }

  updateCommercial(
    scope: AuthorizedRepositoryScope,
    leadId: string,
    input: LeadCommercialPatch,
    audit: AuditContext,
  ): Promise<LeadRecord | null> {
    return withTransaction(this.pool, async (client) => {
      const scoped = leadScope(scope, 2);
      const current = await this.selectOne(client, leadId, scoped, true);
      if (current === null) return null;
      if (input.serviceId !== undefined && input.serviceId !== null) {
        const service = await client.query("SELECT 1 FROM services WHERE id = $1 AND is_active = true", [input.serviceId]);
        if (service.rowCount === 0) throw Object.assign(new Error("service_not_found"), { code: "ILVOX_SERVICE_NOT_FOUND" });
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };
      if (input.fullName !== undefined) set("full_name", input.fullName);
      if (input.companyName !== undefined) set("company_name", input.companyName);
      if (input.email !== undefined) set("email", input.email);
      if (input.phone !== undefined) set("phone", input.phone);
      if (input.serviceId !== undefined) set("service_id", input.serviceId);
      if (input.message !== undefined) set("message", input.message);
      if (input.source !== undefined) set("source", input.source);
      if (fields.length === 0) return current;
      values.push(leadId);
      await client.query(
        `UPDATE leads SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const changed = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      );
      await insertAuditEvent(client, {
        ...audit,
        action: "lead.commercial_updated",
        entityType: "lead",
        entityId: leadId,
        oldValues: Object.fromEntries(Object.keys(changed).map((key) => [key, current[key as keyof LeadRecord]])),
        newValues: changed,
      });
      return this.selectOne(client, leadId, { sql: "true", values: [] });
    });
  }

  transition(
    scope: AuthorizedRepositoryScope,
    leadId: string,
    currentStatus: LeadRecord["status"],
    nextStatus: LeadRecord["status"],
    reason: string | undefined,
    audit: AuditContext,
  ): Promise<LeadRecord | "concurrent" | null> {
    return withTransaction(this.pool, async (client) => {
      const scoped = leadScope(scope, 2);
      const existing = await this.selectOne(client, leadId, scoped);
      if (existing === null) return null;
      const updateScope = leadScope(scope, 3);
      const values = [leadId, currentStatus, ...updateScope.values];
      const updated = await client.query<{ readonly id: string }>(
        `UPDATE leads l SET status = $${values.length + 1}, updated_at = now()
         WHERE l.id = $1 AND l.status = $2 AND ${updateScope.sql}
         RETURNING id`,
        [...values, nextStatus],
      );
      if (updated.rowCount === 0) return "concurrent";
      await insertAuditEvent(client, {
        ...audit,
        action: "lead.status_transitioned",
        entityType: "lead",
        entityId: leadId,
        oldValues: { status: currentStatus },
        newValues: { status: nextStatus, ...(reason === undefined ? {} : { reason: reason.slice(0, 500) }) },
      });
      return this.selectOne(client, leadId, { sql: "true", values: [] });
    });
  }

  assign(
    scope: AuthorizedRepositoryScope,
    leadId: string,
    assignedToUserId: string,
    audit: AuditContext,
  ): Promise<LeadRecord | "ineligible" | null> {
    return withTransaction(this.pool, async (client) => {
      const eligible = await client.query(
        `SELECT 1
         FROM app_users u
         WHERE u.id = $1 AND u.status = 'active'
           AND EXISTS (
             SELECT 1 FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id AND r.scope = 'global'
             WHERE ur.user_id = u.id
           )`,
        [assignedToUserId],
      );
      if (eligible.rowCount === 0) return "ineligible";
      const scoped = leadScope(scope, 2);
      const existing = await this.selectOne(client, leadId, scoped, true);
      if (existing === null) return null;
      await client.query(
        "UPDATE leads SET assigned_to_user_id = $1, updated_at = now() WHERE id = $2",
        [assignedToUserId, leadId],
      );
      await insertAuditEvent(client, {
        ...audit,
        action: "lead.assigned",
        entityType: "lead",
        entityId: leadId,
        oldValues: { assignedToUserId: existing.assignedToUserId },
        newValues: { assignedToUserId },
      });
      return this.selectOne(client, leadId, { sql: "true", values: [] });
    });
  }

  convert(
    leadRepositoryScope: AuthorizedRepositoryScope,
    organizationRepositoryScope: AuthorizedRepositoryScope | undefined,
    leadId: string,
    input: LeadConversionInput,
    audit: AuditContext,
  ) {
    return withTransaction(this.pool, async (client) => {
      const scopedLead = leadScope(leadRepositoryScope, 2);
      const lead = await this.selectOne(client, leadId, scopedLead, true);
      if (lead === null) return null;
      if (lead.status === "converted") {
        const auditModeResult = await client.query<{ readonly mode: string | null }>(
          `SELECT new_values ->> 'mode' AS mode
           FROM audit_events
           WHERE entity_type = 'lead' AND entity_id = $1 AND action = 'lead.converted'
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [leadId],
        );
        const recordedMode = auditModeResult.rows[0]?.mode;
        const persistedMode = lead.convertedOrganizationId === null
          ? "standalone"
          : recordedMode;
        if (persistedMode !== undefined && persistedMode !== null && persistedMode !== input.mode) {
          return "organization_conflict" as const;
        }
        if (input.mode === "standalone") {
          if (lead.convertedOrganizationId !== null) return "organization_conflict" as const;
          return {
            mode: "standalone" as const,
            leadId,
            organizationCreated: false,
            organizationId: null,
            status: "converted" as const,
            idempotent: true,
            primaryContactCreated: false as const,
          };
        }
        if (lead.convertedOrganizationId === null) return "organization_conflict" as const;
        if (input.mode === "reuse_organization" &&
            input.organizationId !== lead.convertedOrganizationId) {
          return "organization_conflict" as const;
        }
        if (input.mode === "create_organization") {
          const organization = await client.query<{
            readonly name: string;
            readonly country_code: string | null;
            readonly tax_id_normalized: string | null;
          }>(
            `SELECT name, country_code, tax_id_normalized
             FROM organizations WHERE id = $1`,
            [lead.convertedOrganizationId],
          );
          const row = organization.rows[0];
          if (row === undefined || row.name !== input.name ||
              (input.countryCode !== undefined && row.country_code !== input.countryCode) ||
              (input.taxId !== undefined && row.tax_id_normalized !== normalizeTaxId(input.taxId))) {
            return "organization_conflict" as const;
          }
        }
        return {
          mode: input.mode,
          leadId,
          organizationCreated: input.mode === "create_organization",
          organizationId: lead.convertedOrganizationId,
          status: "converted" as const,
          idempotent: true,
          primaryContactCreated: false as const,
        };
      }
      if (lead.status !== "approved") return "not_approved" as const;

      if (input.mode === "standalone") {
        await client.query(
          `UPDATE leads
           SET status = 'converted', converted_organization_id = NULL,
               converted_at = now(), updated_at = now()
           WHERE id = $1`,
          [leadId],
        );
        await insertAuditEvent(client, {
          ...audit,
          action: "lead.converted",
          entityType: "lead",
          entityId: leadId,
          oldValues: { status: "approved" },
          newValues: {
            mode: "standalone",
            status: "converted",
            organizationId: null,
            organizationCreated: false,
            primaryContactCreated: false,
          },
        });
        return {
          mode: "standalone" as const,
          leadId,
          organizationCreated: false,
          organizationId: null,
          status: "converted" as const,
          idempotent: false,
          primaryContactCreated: false as const,
        };
      }

      let organizationId: string;
      if (input.mode === "reuse_organization") {
        if (organizationRepositoryScope === undefined) {
          return "organization_conflict" as const;
        }
        const scopedOrganization = organizationScope(organizationRepositoryScope, "o", 2);
        const organization = await client.query<{ readonly id: string }>(
          `SELECT o.id FROM organizations o
           WHERE o.id = $1 AND o.status = 'active' AND ${scopedOrganization.sql}
           FOR UPDATE`,
          [input.organizationId, ...scopedOrganization.values],
        );
        if (organization.rows[0] === undefined) return "organization_conflict" as const;
        organizationId = organization.rows[0].id;
      } else {
        const accountManagerUserId = input.accountManagerUserId ?? lead.assignedToUserId;
        if (accountManagerUserId !== null) {
          const manager = await client.query(
            `SELECT 1 FROM app_users u
             WHERE u.id = $1 AND u.status = 'active'
               AND EXISTS (
                 SELECT 1 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id AND r.scope = 'global'
                 WHERE ur.user_id = u.id
               )`,
            [accountManagerUserId],
          );
          if (manager.rowCount === 0) return "ineligible_manager" as const;
        }
        const taxIdNormalized = input.taxId === undefined ? null : normalizeTaxId(input.taxId);
        try {
          const organization = await client.query<{ readonly id: string }>(
            `INSERT INTO organizations (
               name, legal_name, industry, size, status, country_code,
               tax_id, tax_id_normalized, account_manager_user_id
             ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)
             RETURNING id`,
            [
              input.name,
              input.legalName ?? null,
              input.industry ?? null,
              input.size ?? null,
              input.countryCode ?? null,
              input.taxId ?? null,
              taxIdNormalized,
              accountManagerUserId,
            ],
          );
          organizationId = organization.rows[0]!.id;
        } catch (error) {
          if ((error as { readonly code?: string }).code === "23505") return "organization_conflict" as const;
          throw error;
        }
        await insertAuditEvent(client, {
          ...audit,
          organizationId,
          action: "organization.created_from_lead",
          entityType: "organization",
          entityId: organizationId,
          newValues: { name: input.name, sourceLeadId: leadId, status: "active" },
        });
      }

      await client.query(
        `UPDATE leads
         SET status = 'converted', converted_organization_id = $1,
             converted_at = now(), updated_at = now()
         WHERE id = $2`,
        [organizationId, leadId],
      );
      await insertAuditEvent(client, {
        ...audit,
        organizationId,
        action: "lead.converted",
        entityType: "lead",
        entityId: leadId,
        oldValues: { status: "approved" },
        newValues: {
          mode: input.mode,
          status: "converted",
          organizationId,
          organizationCreated: input.mode === "create_organization",
          primaryContactCreated: false,
        },
      });
      return {
        mode: input.mode,
        leadId,
        organizationCreated: input.mode === "create_organization",
        organizationId,
        status: "converted" as const,
        idempotent: false,
        primaryContactCreated: false as const,
      };
    });
  }

  private async selectOne(
    executor: Pick<Pool, "query"> | PoolClient,
    leadId: string,
    scope: { readonly sql: string; readonly values: unknown[] },
    forUpdate = false,
  ): Promise<LeadRecord | null> {
    const result = await executor.query<LeadRow>(
      `${LEAD_SELECT} WHERE l.id = $1 AND ${scope.sql}${forUpdate ? " FOR UPDATE OF l" : ""}`,
      [leadId, ...scope.values],
    );
    return result.rows[0] === undefined ? null : mapLead(result.rows[0]);
  }
}
