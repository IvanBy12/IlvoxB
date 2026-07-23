import type { Pool, PoolClient } from "pg";
import { paginationMeta, paginationOffset } from "../../common/http/pagination.js";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type {
  ServiceCatalogCreateInput,
  ServiceCatalogItem,
  ServiceCatalogListInput,
  ServiceCatalogPatch,
  ServiceCatalogRepository,
} from "./service-catalog.types.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";

interface ServiceRow {
  readonly id: string;
  readonly name: string;
  readonly category: ServiceCatalogItem["category"];
  readonly description: string;
  readonly is_public: boolean;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapService(row: ServiceRow): ServiceCatalogItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    isPublic: row.is_public,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function filters(
  input: ServiceCatalogListInput,
  publicOnly: boolean,
): { readonly sql: string; readonly values: unknown[] } {
  const clauses = publicOnly ? ["is_public = true", "is_active = true"] : ["true"];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (input.search !== undefined) add("name ILIKE '%' || ? || '%'", input.search);
  if (input.category !== undefined) add("category = ?", input.category);
  if (!publicOnly && input.isPublic !== undefined) add("is_public = ?", input.isPublic);
  if (!publicOnly && input.isActive !== undefined) add("is_active = ?", input.isActive);
  return { sql: clauses.join(" AND "), values };
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
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

export class PostgresServiceCatalogRepository implements ServiceCatalogRepository {
  constructor(private readonly pool: Pool) {}

  async listPublic(input: ServiceCatalogListInput) {
    return this.list(input, true);
  }

  async findPublicById(serviceId: string): Promise<ServiceCatalogItem | null> {
    const result = await this.pool.query<ServiceRow>(
      `SELECT id, name, category, description, is_public, is_active, created_at, updated_at
       FROM services
       WHERE id = $1 AND is_public = true AND is_active = true`,
      [serviceId],
    );
    return result.rows[0] === undefined ? null : mapService(result.rows[0]);
  }

  async listAuthorized(scope: AuthorizedRepositoryScope, input: ServiceCatalogListInput) {
    if (scope.kind !== "global") return { items: [], pagination: paginationMeta(input, 0) };
    return this.list(input, false);
  }

  async findAuthorizedById(
    scope: AuthorizedRepositoryScope,
    serviceId: string,
  ): Promise<ServiceCatalogItem | null> {
    if (scope.kind !== "global") return null;
    const result = await this.pool.query<ServiceRow>(
      `SELECT id, name, category, description, is_public, is_active, created_at, updated_at
       FROM services WHERE id = $1`,
      [serviceId],
    );
    return result.rows[0] === undefined ? null : mapService(result.rows[0]);
  }

  createAuthorized(
    scope: AuthorizedRepositoryScope,
    input: ServiceCatalogCreateInput,
    audit: AuditContext,
  ): Promise<ServiceCatalogItem | "duplicate"> {
    if (scope.kind !== "global") return Promise.resolve("duplicate");
    return transaction(this.pool, async (client) => {
      try {
        const result = await client.query<ServiceRow>(
          `INSERT INTO services (name, category, description, is_public, is_active)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, category, description, is_public, is_active, created_at, updated_at`,
          [input.name, input.category, input.description, input.isPublic, input.isActive],
        );
        const service = mapService(result.rows[0]!);
        await insertAuditEvent(client, {
          ...audit,
          action: "service.created",
          entityType: "service",
          entityId: service.id,
          newValues: {
            name: service.name,
            category: service.category,
            isPublic: service.isPublic,
            isActive: service.isActive,
          },
        });
        return service;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  updateAuthorized(
    scope: AuthorizedRepositoryScope,
    serviceId: string,
    input: ServiceCatalogPatch,
    audit: AuditContext,
  ): Promise<ServiceCatalogItem | "duplicate" | null> {
    if (scope.kind !== "global") return Promise.resolve(null);
    return transaction(this.pool, async (client) => {
      const currentResult = await client.query<ServiceRow>(
        `SELECT id, name, category, description, is_public, is_active, created_at, updated_at
         FROM services WHERE id = $1 FOR UPDATE`,
        [serviceId],
      );
      const currentRow = currentResult.rows[0];
      if (currentRow === undefined) return null;
      const current = mapService(currentRow);
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };
      if (input.name !== undefined) set("name", input.name);
      if (input.category !== undefined) set("category", input.category);
      if (input.description !== undefined) set("description", input.description);
      if (input.isPublic !== undefined) set("is_public", input.isPublic);
      if (input.isActive !== undefined) set("is_active", input.isActive);
      if (fields.length === 0) return current;
      values.push(serviceId);
      try {
        const result = await client.query<ServiceRow>(
          `UPDATE services SET ${fields.join(", ")}, updated_at = now()
           WHERE id = $${values.length}
           RETURNING id, name, category, description, is_public, is_active, created_at, updated_at`,
          values,
        );
        const service = mapService(result.rows[0]!);
        const changed = Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        );
        await insertAuditEvent(client, {
          ...audit,
          action: "service.updated",
          entityType: "service",
          entityId: serviceId,
          oldValues: Object.fromEntries(
            Object.keys(changed).map((key) => [key, current[key as keyof ServiceCatalogItem]]),
          ),
          newValues: changed,
        });
        return service;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  private async list(input: ServiceCatalogListInput, publicOnly: boolean) {
    const where = filters(input, publicOnly);
    const countResult = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM services WHERE ${where.sql}`,
      where.values,
    );
    const values = [...where.values, input.pageSize, paginationOffset(input)];
    const rows = await this.pool.query<ServiceRow>(
      `SELECT id, name, category, description, is_public, is_active, created_at, updated_at
       FROM services
       WHERE ${where.sql}
       ORDER BY name ASC, id ASC
       LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return { items: rows.rows.map(mapService), pagination: paginationMeta(input, total) };
  }
}
