import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { AuthorizedRepositoryScope } from "./authorization.types.js";

export interface ScopeColumns {
  readonly organizationId?: SQLWrapper;
  readonly ownerId?: SQLWrapper;
  readonly assigneeId?: SQLWrapper;
  readonly publicFlag?: SQLWrapper;
}

const falsePredicate = sql`false`;

function organizationPredicate(
  organizationId: SQLWrapper | undefined,
  organizationIds: readonly string[],
): SQL {
  if (organizationId === undefined || organizationIds.length === 0) return falsePredicate;
  return inArray(organizationId as never, [...organizationIds]);
}

export function buildScopeFilter(scope: AuthorizedRepositoryScope, columns: ScopeColumns): SQL {
  if (scope.kind === "global") return sql`true`;
  if (scope.kind === "public") {
    return columns.publicFlag === undefined ? falsePredicate : eq(columns.publicFlag as never, true);
  }

  const organization = organizationPredicate(columns.organizationId, scope.organizationIds);
  if (scope.kind === "organization") return organization;

  const actorColumn = scope.kind === "own" ? columns.ownerId : columns.assigneeId;
  if (actorColumn === undefined) return falsePredicate;
  const actor = eq(actorColumn as never, scope.actorId);
  if (columns.organizationId === undefined) return actor;
  return and(organization, actor) ?? falsePredicate;
}

export function combineScopeWithResourceAccess(
  scopeFilter: SQL,
  resourcePredicates: readonly (SQL | undefined)[],
): SQL {
  const resource = or(...resourcePredicates.filter((value): value is SQL => value !== undefined));
  return resource === undefined ? falsePredicate : (and(scopeFilter, resource) ?? falsePredicate);
}

export function isOrganizationInScope(
  scope: AuthorizedRepositoryScope,
  organizationId: string,
): boolean {
  return scope.kind === "global" ||
    (scope.kind !== "public" && scope.organizationIds.includes(organizationId));
}
