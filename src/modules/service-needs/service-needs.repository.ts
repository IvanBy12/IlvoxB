import type { Pool, PoolClient } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import type { PaginatedResult } from "../../common/http/pagination.js";
import type { ServiceCatalogItem } from "../services/service-catalog.types.js";
import type {
  PublicServiceNeed,
  PublicServiceNeedLink,
  ServiceNeed,
  ServiceNeedCreateInput,
  ServiceNeedDetail,
  ServiceNeedLink,
  ServiceNeedLinkInput,
  ServiceNeedListInput,
  ServiceNeedPatch,
  ServiceNeedRepository,
} from "./service-needs.types.js";

interface NeedRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly short_description: string;
  readonly detailed_description: string;
  readonly icon_key: string;
  readonly display_order: number;
  readonly is_public: boolean;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface LinkRow {
  readonly id: string;
  readonly name: string;
  readonly category: ServiceCatalogItem["category"];
  readonly description: string;
  readonly is_public: boolean;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly weight: number;
  readonly is_primary: boolean;
}

const needColumns = `id, code, title, short_description, detailed_description, icon_key,
  display_order, is_public, is_active, created_at, updated_at`;

function mapNeed(row: NeedRow): ServiceNeed {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    shortDescription: row.short_description,
    detailedDescription: row.detailed_description,
    iconKey: row.icon_key,
    displayOrder: row.display_order,
    isPublic: row.is_public,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPublicNeed(row: NeedRow): PublicServiceNeed {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    shortDescription: row.short_description,
    detailedDescription: row.detailed_description,
    iconKey: row.icon_key,
    displayOrder: row.display_order,
  };
}

function mapLink(row: LinkRow): ServiceNeedLink {
  return {
    service: {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      isPublic: row.is_public,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    weight: row.weight,
    isPrimary: row.is_primary,
  };
}

function mapPublicLink(row: LinkRow): PublicServiceNeedLink {
  return {
    service: {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
    },
    weight: row.weight,
    isPrimary: row.is_primary,
  };
}

function whereFor(input: ServiceNeedListInput, publicOnly: boolean) {
  const clauses = publicOnly ? ["is_public = true", "is_active = true"] : ["true"];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (input.search !== undefined) {
    values.push(input.search);
    clauses.push(`(title ILIKE '%' || $${values.length} || '%' OR code ILIKE '%' || $${values.length} || '%')`);
  }
  if (!publicOnly && input.isPublic !== undefined) add("is_public = ?", input.isPublic);
  if (!publicOnly && input.isActive !== undefined) add("is_active = ?", input.isActive);
  return { sql: clauses.join(" AND "), values };
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

export class PostgresServiceNeedRepository implements ServiceNeedRepository {
  constructor(private readonly pool: Pool) {}

  listPublic(input: ServiceNeedListInput) {
    return this.list(input, true);
  }

  async findPublicById(needId: string): Promise<PublicServiceNeed | null> {
    const result = await this.pool.query<NeedRow>(
      `SELECT ${needColumns} FROM service_needs WHERE id = $1 AND is_public = true AND is_active = true`,
      [needId],
    );
    return result.rows[0] === undefined ? null : mapPublicNeed(result.rows[0]);
  }

  async listPublicServices(needId: string): Promise<readonly PublicServiceNeedLink[]> {
    return this.listLinks(this.pool, needId, true);
  }

  listAuthorized(scope: AuthorizedRepositoryScope, input: ServiceNeedListInput) {
    if (scope.kind !== "global") return Promise.resolve({ items: [], pagination: paginationMeta(input, 0) });
    return this.list(input, false);
  }

  async findAuthorizedById(scope: AuthorizedRepositoryScope, needId: string): Promise<ServiceNeedDetail | null> {
    if (scope.kind !== "global") return null;
    return this.findDetail(this.pool, needId);
  }

  createAuthorized(scope: AuthorizedRepositoryScope, input: ServiceNeedCreateInput, audit: AuditContext) {
    if (scope.kind !== "global") return Promise.resolve("duplicate" as const);
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox:service-needs:title-uniqueness'))");
      const duplicateTitle = await client.query<{ readonly exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM service_needs WHERE lower(btrim(title)) = lower(btrim($1))) AS exists",
        [input.title],
      );
      if (duplicateTitle.rows[0]?.exists) return "duplicate" as const;
      try {
        const result = await client.query<NeedRow>(
          `INSERT INTO service_needs
             (code, title, short_description, detailed_description, icon_key, display_order, is_public, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${needColumns}`,
          [input.code, input.title, input.shortDescription, input.detailedDescription, input.iconKey, input.displayOrder, input.isPublic, input.isActive],
        );
        const need = mapNeed(result.rows[0]!);
        await insertAuditEvent(client, {
          ...audit,
          action: "service_need.created",
          entityType: "service_need",
          entityId: need.id,
          newValues: { code: need.code, title: need.title, displayOrder: need.displayOrder, isPublic: need.isPublic, isActive: need.isActive },
        });
        return need;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  updateAuthorized(scope: AuthorizedRepositoryScope, needId: string, input: ServiceNeedPatch, audit: AuditContext) {
    if (scope.kind !== "global") return Promise.resolve(null);
    return transaction(this.pool, async (client) => {
      if (input.title !== undefined) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox:service-needs:title-uniqueness'))");
      }
      const currentResult = await client.query<NeedRow>(`SELECT ${needColumns} FROM service_needs WHERE id = $1 FOR UPDATE`, [needId]);
      const currentRow = currentResult.rows[0];
      if (currentRow === undefined) return null;
      const current = mapNeed(currentRow);
      if (input.title !== undefined) {
        const duplicateTitle = await client.query<{ readonly exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM service_needs WHERE id <> $1 AND lower(btrim(title)) = lower(btrim($2))) AS exists",
          [needId, input.title],
        );
        if (duplicateTitle.rows[0]?.exists) return "duplicate" as const;
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => { values.push(value); fields.push(`${column} = $${values.length}`); };
      if (input.code !== undefined) set("code", input.code);
      if (input.title !== undefined) set("title", input.title);
      if (input.shortDescription !== undefined) set("short_description", input.shortDescription);
      if (input.detailedDescription !== undefined) set("detailed_description", input.detailedDescription);
      if (input.iconKey !== undefined) set("icon_key", input.iconKey);
      if (input.displayOrder !== undefined) set("display_order", input.displayOrder);
      if (input.isPublic !== undefined) set("is_public", input.isPublic);
      if (input.isActive !== undefined) set("is_active", input.isActive);
      if (fields.length === 0) return current;
      values.push(needId);
      try {
        const result = await client.query<NeedRow>(
          `UPDATE service_needs SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING ${needColumns}`,
          values,
        );
        const need = mapNeed(result.rows[0]!);
        await insertAuditEvent(client, {
          ...audit,
          action: "service_need.updated",
          entityType: "service_need",
          entityId: needId,
          oldValues: { code: current.code, title: current.title, displayOrder: current.displayOrder, isPublic: current.isPublic, isActive: current.isActive },
          newValues: { code: need.code, title: need.title, displayOrder: need.displayOrder, isPublic: need.isPublic, isActive: need.isActive },
        });
        return need;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  replaceLinksAuthorized(scope: AuthorizedRepositoryScope, needId: string, links: readonly ServiceNeedLinkInput[], audit: AuditContext) {
    if (scope.kind !== "global") return Promise.resolve(null);
    return transaction(this.pool, async (client) => {
      const needResult = await client.query<{ readonly id: string }>("SELECT id FROM service_needs WHERE id = $1 FOR UPDATE", [needId]);
      if (needResult.rows[0] === undefined) return null;
      if (links.length > 0) {
        const ids = links.map((link) => link.serviceId);
        const services = await client.query<{ readonly total: string }>("SELECT count(*)::text AS total FROM services WHERE id = ANY($1::uuid[])", [ids]);
        if (Number(services.rows[0]?.total ?? 0) !== new Set(ids).size) return "service_not_found" as const;
      }
      await client.query("DELETE FROM service_need_links WHERE need_id = $1", [needId]);
      for (const link of links) {
        await client.query(
          "INSERT INTO service_need_links (need_id, service_id, weight, is_primary) VALUES ($1, $2, $3, $4)",
          [needId, link.serviceId, link.weight, link.isPrimary],
        );
      }
      await insertAuditEvent(client, {
        ...audit,
        action: "service_need.services_replaced",
        entityType: "service_need",
        entityId: needId,
        newValues: { serviceCount: links.length, primaryServiceCount: links.filter((link) => link.isPrimary).length },
      });
      return this.findDetail(client, needId);
    });
  }

  private list(input: ServiceNeedListInput, publicOnly: true): Promise<PaginatedResult<PublicServiceNeed>>;
  private list(input: ServiceNeedListInput, publicOnly: false): Promise<PaginatedResult<ServiceNeed>>;
  private async list(input: ServiceNeedListInput, publicOnly: boolean): Promise<PaginatedResult<PublicServiceNeed | ServiceNeed>> {
    const where = whereFor(input, publicOnly);
    const count = await this.pool.query<{ readonly total: string }>(`SELECT count(*)::text AS total FROM service_needs WHERE ${where.sql}`, where.values);
    const values = [...where.values, input.pageSize, paginationOffset(input)];
    const result = await this.pool.query<NeedRow>(
      `SELECT ${needColumns} FROM service_needs WHERE ${where.sql}
       ORDER BY display_order ASC, title ASC, id ASC LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
      values,
    );
    return {
      items: publicOnly ? result.rows.map(mapPublicNeed) : result.rows.map(mapNeed),
      pagination: paginationMeta(input, Number(count.rows[0]?.total ?? 0)),
    };
  }

  private async findDetail(client: Pick<Pool, "query"> | Pick<PoolClient, "query">, needId: string): Promise<ServiceNeedDetail | null> {
    const result = await client.query<NeedRow>(`SELECT ${needColumns} FROM service_needs WHERE id = $1`, [needId]);
    if (result.rows[0] === undefined) return null;
    return { ...mapNeed(result.rows[0]), services: await this.listLinks(client, needId, false) };
  }

  private listLinks(client: Pick<Pool, "query"> | Pick<PoolClient, "query">, needId: string, publicOnly: true): Promise<readonly PublicServiceNeedLink[]>;
  private listLinks(client: Pick<Pool, "query"> | Pick<PoolClient, "query">, needId: string, publicOnly: false): Promise<readonly ServiceNeedLink[]>;
  private async listLinks(client: Pick<Pool, "query"> | Pick<PoolClient, "query">, needId: string, publicOnly: boolean): Promise<readonly (PublicServiceNeedLink | ServiceNeedLink)[]> {
    const result = await client.query<LinkRow>(
      `SELECT s.id, s.name, s.category, s.description, s.is_public, s.is_active, s.created_at, s.updated_at,
              l.weight, l.is_primary
       FROM service_need_links l JOIN services s ON s.id = l.service_id
       WHERE l.need_id = $1 ${publicOnly ? "AND s.is_public = true AND s.is_active = true" : ""}
       ORDER BY l.is_primary DESC, l.weight DESC, s.name ASC, s.id ASC`,
      [needId],
    );
    return publicOnly ? result.rows.map(mapPublicLink) : result.rows.map(mapLink);
  }
}
