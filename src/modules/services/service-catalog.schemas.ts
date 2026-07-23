import { Type, type Static } from "@sinclair/typebox";
import { SERVICE_CATEGORIES } from "./service-catalog.types.js";

const BooleanQuery = Type.Union([Type.Boolean(), Type.Literal("true"), Type.Literal("false")]);

export const ServiceIdParamsSchema = Type.Object({
  serviceId: Type.String({ format: "uuid" }),
});

export const ServiceListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  category: Type.Optional(Type.Union(SERVICE_CATEGORIES.map((value) => Type.Literal(value)))),
  isPublic: Type.Optional(BooleanQuery),
  isActive: Type.Optional(BooleanQuery),
});

export const ServiceCreateBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  category: Type.Union(SERVICE_CATEGORIES.map((value) => Type.Literal(value))),
  description: Type.String({ minLength: 1, maxLength: 5000 }),
  isPublic: Type.Optional(Type.Boolean({ default: true })),
  isActive: Type.Optional(Type.Boolean({ default: true })),
}, { additionalProperties: false });

export const ServicePatchBodySchema = Type.Partial(Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  category: Type.Union(SERVICE_CATEGORIES.map((value) => Type.Literal(value))),
  description: Type.String({ minLength: 1, maxLength: 5000 }),
  isPublic: Type.Boolean(),
  isActive: Type.Boolean(),
}, { additionalProperties: false }), { minProperties: 1 });

export type ServiceIdParams = Static<typeof ServiceIdParamsSchema>;
export type ServiceListQuery = Static<typeof ServiceListQuerySchema>;
export type ServiceCreateBody = Static<typeof ServiceCreateBodySchema>;
export type ServicePatchBody = Static<typeof ServicePatchBodySchema>;
