import { Type, type Static } from "@sinclair/typebox";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const Scope = Type.Union([
  Type.Literal("global"), Type.Literal("organization"), Type.Literal("assigned"),
  Type.Literal("own"), Type.Literal("public"),
]);

export const MeResponseSchema = Type.Object({
  data: Type.Object({
    user: Type.Object({
      id: Type.String({ format: "uuid" }),
      status: Type.Literal("active"),
      internal: Type.Boolean(),
      primaryEmail: Type.String({ format: "email" }),
      firstName: NullableString,
      lastName: NullableString,
      avatarUrl: NullableString,
    }, { additionalProperties: false }),
    organizations: Type.Array(Type.Object({
      id: Type.String({ format: "uuid" }),
      membershipStatus: Type.Literal("active"),
      role: Type.String(),
    }, { additionalProperties: false })),
    roles: Type.Array(Type.Object({
      roleId: Type.String({ format: "uuid" }),
      code: Type.String(),
      scope: Type.Union([Type.Literal("global"), Type.Literal("organization"), Type.Literal("project")]),
      organizationId: Type.Optional(Type.String({ format: "uuid" })),
      projectId: Type.Optional(Type.String({ format: "uuid" })),
    }, { additionalProperties: false })),
    effectivePermissions: Type.Array(Type.Object({
      code: Type.String(),
      scopes: Type.Array(Scope),
      scopeOrganizationIds: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String({ format: "uuid" })))),
    }, { additionalProperties: false })),
    capabilities: Type.Object({
      canCreateTicket: Type.Boolean(),
      canManageMembers: Type.Boolean(),
      canReadOrganizationFiles: Type.Boolean(),
      canUploadOrganizationFiles: Type.Boolean(),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export type MeResponse = Static<typeof MeResponseSchema>;
