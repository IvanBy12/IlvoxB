import { Type, type Static } from "@sinclair/typebox";
import { ELIGIBLE_USER_PURPOSES } from "./user-catalog.types.js";

const literalUnion = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));
const UserStatusSchema = literalUnion(["pending", "active", "blocked", "deleted"] as const);
const UserRoleArraySchema = Type.Array(Type.String({ minLength: 1, maxLength: 64 }));

export const UserIdParamsSchema = Type.Object({
  userId: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export const UserRoleParamsSchema = Type.Object({
  userId: Type.String({ format: "uuid" }),
  roleCode: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });

export const UserRoleGrantBodySchema = Type.Object({
  roleCode: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });

export const UserCatalogListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
  status: Type.Optional(UserStatusSchema),
  type: Type.Optional(literalUnion(["internal", "client"] as const)),
  role: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  sortBy: Type.Optional(literalUnion(["displayName", "email", "createdAt"] as const)),
  sortDirection: Type.Optional(literalUnion(["asc", "desc"] as const)),
}, { additionalProperties: false });

export const EligibleUserQuerySchema = Type.Object({
  purpose: literalUnion(ELIGIBLE_USER_PURPOSES),
  organizationId: Type.Optional(Type.String({ format: "uuid" })),
  projectId: Type.Optional(Type.String({ format: "uuid" })),
  ticketId: Type.Optional(Type.String({ format: "uuid" })),
  taskId: Type.Optional(Type.String({ format: "uuid" })),
  leadId: Type.Optional(Type.String({ format: "uuid" })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
}, { additionalProperties: false });

export const UserCatalogItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  displayName: Type.String(),
  email: Type.String({ format: "email" }),
  status: UserStatusSchema,
  isInternal: Type.Boolean(),
  roles: UserRoleArraySchema,
  internalRoles: UserRoleArraySchema,
  hasClientAccess: Type.Boolean(),
  createdAt: Type.String({ format: "date-time" }),
  lastAccessAt: Type.Null(),
}, { additionalProperties: false });

export const UserCatalogDetailSchema = Type.Object({
  ...UserCatalogItemSchema.properties,
  identitySynchronized: Type.Boolean(),
  effectivePermissions: Type.Array(Type.String({ minLength: 1, maxLength: 100 })),
}, { additionalProperties: false });

export const EligibleUserItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  displayName: Type.String(),
  email: Type.String({ format: "email" }),
  roles: UserRoleArraySchema,
}, { additionalProperties: false });

export const UserCatalogListResponseSchema = Type.Object({
  data: Type.Object({
    items: Type.Array(UserCatalogItemSchema),
    pagination: Type.Object({
      page: Type.Integer(),
      pageSize: Type.Integer(),
      total: Type.Integer(),
      totalPages: Type.Integer(),
    }, { additionalProperties: false }),
    summary: Type.Object({
      active: Type.Integer({ minimum: 0 }),
      pending: Type.Integer({ minimum: 0 }),
      blocked: Type.Integer({ minimum: 0 }),
      deleted: Type.Integer({ minimum: 0 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const UserCatalogDetailResponseSchema = Type.Object({
  data: UserCatalogDetailSchema,
}, { additionalProperties: false });

export const UserMutationResponseSchema = Type.Object({
  data: Type.Object({
    kind: literalUnion(["changed", "unchanged"] as const),
    user: UserCatalogDetailSchema,
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const EligibleUserResponseSchema = Type.Object({
  data: Type.Object({ items: Type.Array(EligibleUserItemSchema) }, { additionalProperties: false }),
}, { additionalProperties: false });

export type UserIdParams = Static<typeof UserIdParamsSchema>;
export type UserRoleParams = Static<typeof UserRoleParamsSchema>;
export type UserRoleGrantBody = Static<typeof UserRoleGrantBodySchema>;
export type UserCatalogListQuery = Static<typeof UserCatalogListQuerySchema>;
export type EligibleUserHttpQuery = Static<typeof EligibleUserQuerySchema>;
