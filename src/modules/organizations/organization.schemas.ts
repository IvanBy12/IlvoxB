import { Type, type Static } from "@sinclair/typebox";

const OrganizationStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("inactive"),
  Type.Literal("archived"),
]);
const OrganizationSizeSchema = Type.Union([
  Type.Literal("micro"),
  Type.Literal("small"),
  Type.Literal("medium"),
  Type.Literal("large"),
]);
const MemberRoleSchema = Type.Union([Type.Literal("client_manager"), Type.Literal("client_contact")]);
const NullableString = (maxLength: number) =>
  Type.Union([Type.String({ minLength: 1, maxLength }), Type.Null()]);

export const OrganizationIdParamsSchema = Type.Object({
  organizationId: Type.String({ format: "uuid" }),
});
export const OrganizationMemberParamsSchema = Type.Object({
  organizationId: Type.String({ format: "uuid" }),
  memberId: Type.String({ format: "uuid" }),
});
export const OrganizationListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  status: Type.Optional(OrganizationStatusSchema),
  createdFrom: Type.Optional(Type.String({ format: "date-time" })),
  createdTo: Type.Optional(Type.String({ format: "date-time" })),
});
export const OrganizationCreateBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  legalName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  industry: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  size: Type.Optional(OrganizationSizeSchema),
  countryCode: Type.Optional(Type.String({ pattern: "^[A-Z]{2}$" })),
  taxId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  accountManagerUserId: Type.Optional(Type.String({ format: "uuid" })),
});
export const OrganizationPatchBodySchema = Type.Partial(Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  legalName: NullableString(200),
  industry: NullableString(120),
  size: Type.Union([OrganizationSizeSchema, Type.Null()]),
  status: OrganizationStatusSchema,
  countryCode: Type.Union([Type.String({ pattern: "^[A-Z]{2}$" }), Type.Null()]),
  taxId: NullableString(64),
  accountManagerUserId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
}), { minProperties: 1 });
export const OrganizationMemberCreateBodySchema = Type.Object({
  userId: Type.String({ format: "uuid" }),
  roleCode: MemberRoleSchema,
  status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("active")])),
  jobTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  phone: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
});
export const OrganizationMemberPatchBodySchema = Type.Partial(Type.Object({
  roleCode: MemberRoleSchema,
  status: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("revoked")]),
  jobTitle: NullableString(120),
  phone: NullableString(40),
}), { minProperties: 1 });

export type OrganizationIdParams = Static<typeof OrganizationIdParamsSchema>;
export type OrganizationMemberParams = Static<typeof OrganizationMemberParamsSchema>;
export type OrganizationListQuery = Static<typeof OrganizationListQuerySchema>;
export type OrganizationCreateBody = Static<typeof OrganizationCreateBodySchema>;
export type OrganizationPatchBody = Static<typeof OrganizationPatchBodySchema>;
export type OrganizationMemberCreateBody = Static<typeof OrganizationMemberCreateBodySchema>;
export type OrganizationMemberPatchBody = Static<typeof OrganizationMemberPatchBodySchema>;
