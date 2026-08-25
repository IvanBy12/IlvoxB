import { Type, type Static } from "@sinclair/typebox";

const BooleanQuery = Type.Union([Type.Boolean(), Type.Literal("true"), Type.Literal("false")]);
const SafeText = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "^[^<>]+$" });

export const ServiceNeedIdParamsSchema = Type.Object({ needId: Type.String({ format: "uuid" }) });

export const ServiceNeedListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  isPublic: Type.Optional(BooleanQuery),
  isActive: Type.Optional(BooleanQuery),
});

const NeedFields = {
  code: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9_]*$" }),
  title: SafeText(160),
  shortDescription: SafeText(500),
  detailedDescription: SafeText(2000),
  iconKey: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9-]*$" }),
  displayOrder: Type.Integer({ minimum: 0, maximum: 100000 }),
  isPublic: Type.Boolean(),
  isActive: Type.Boolean(),
};

export const ServiceNeedCreateBodySchema = Type.Object({
  ...NeedFields,
  displayOrder: Type.Optional(NeedFields.displayOrder),
  isPublic: Type.Optional(Type.Boolean({ default: true })),
  isActive: Type.Optional(Type.Boolean({ default: true })),
}, { additionalProperties: false });

export const ServiceNeedPatchBodySchema = Type.Partial(
  Type.Object(NeedFields, { additionalProperties: false }),
  { minProperties: 1 },
);

export const ServiceNeedLinksBodySchema = Type.Object({
  services: Type.Array(Type.Object({
    serviceId: Type.String({ format: "uuid" }),
    weight: Type.Integer({ minimum: 1, maximum: 100 }),
    isPrimary: Type.Boolean(),
  }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false });

export type ServiceNeedIdParams = Static<typeof ServiceNeedIdParamsSchema>;
export type ServiceNeedListQuery = Static<typeof ServiceNeedListQuerySchema>;
export type ServiceNeedCreateBody = Static<typeof ServiceNeedCreateBodySchema>;
export type ServiceNeedPatchBody = Static<typeof ServiceNeedPatchBodySchema>;
export type ServiceNeedLinksBody = Static<typeof ServiceNeedLinksBodySchema>;
