import { Type, type Static } from "@sinclair/typebox";
import { LEAD_STATUSES } from "../../common/state-machines/lead-transitions.js";
import { LEAD_SOURCES } from "./lead.types.js";

const NullableString = (maxLength: number) =>
  Type.Union([Type.String({ minLength: 1, maxLength }), Type.Null()]);
const LeadSourceSchema = Type.Union(LEAD_SOURCES.map((value) => Type.Literal(value)));
const LeadStatusSchema = Type.Union(LEAD_STATUSES.map((value) => Type.Literal(value)));

export const LeadIdParamsSchema = Type.Object({
  leadId: Type.String({ format: "uuid" }),
});

export const PublicLeadBodySchema = Type.Object({
  fullName: Type.String({ minLength: 1, maxLength: 160 }),
  companyName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  email: Type.String({ format: "email", maxLength: 320 }),
  phone: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  serviceId: Type.Optional(Type.String({ format: "uuid" })),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
  source: LeadSourceSchema,
  status: Type.Optional(Type.Never()),
  assignedToUserId: Type.Optional(Type.Never()),
  convertedOrganizationId: Type.Optional(Type.Never()),
});

export const LeadListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
  status: Type.Optional(LeadStatusSchema),
  serviceId: Type.Optional(Type.String({ format: "uuid" })),
  assignedToUserId: Type.Optional(Type.String({ format: "uuid" })),
  createdFrom: Type.Optional(Type.String({ format: "date-time" })),
  createdTo: Type.Optional(Type.String({ format: "date-time" })),
  sortBy: Type.Optional(Type.Union([Type.Literal("createdAt"), Type.Literal("updatedAt")])),
  sortDirection: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
});

export const LeadCommercialPatchSchema = Type.Partial(Type.Object({
  fullName: Type.String({ minLength: 1, maxLength: 160 }),
  companyName: NullableString(200),
  email: Type.String({ format: "email", maxLength: 320 }),
  phone: NullableString(40),
  serviceId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
  source: LeadSourceSchema,
  status: Type.Never(),
  assignedToUserId: Type.Never(),
  convertedOrganizationId: Type.Never(),
}), { minProperties: 1 });

export const LeadTransitionBodySchema = Type.Object({
  status: LeadStatusSchema,
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
});

export const LeadAssignmentBodySchema = Type.Object({
  assignedToUserId: Type.String({ format: "uuid" }),
});

const OrganizationSizeSchema = Type.Union([
  Type.Literal("micro"),
  Type.Literal("small"),
  Type.Literal("medium"),
  Type.Literal("large"),
]);

export const LeadConversionBodySchema = Type.Union([
  Type.Object({
    mode: Type.Literal("standalone"),
  }),
  Type.Object({
    mode: Type.Literal("create_organization"),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    legalName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    industry: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    size: Type.Optional(OrganizationSizeSchema),
    countryCode: Type.Optional(Type.String({ pattern: "^[A-Z]{2}$" })),
    taxId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    accountManagerUserId: Type.Optional(Type.String({ format: "uuid" })),
  }),
  Type.Object({
    mode: Type.Literal("reuse_organization"),
    organizationId: Type.String({ format: "uuid" }),
  }),
]);

export type LeadIdParams = Static<typeof LeadIdParamsSchema>;
export type PublicLeadBody = Static<typeof PublicLeadBodySchema>;
export type LeadListQuery = Static<typeof LeadListQuerySchema>;
export type LeadCommercialPatchBody = Static<typeof LeadCommercialPatchSchema>;
export type LeadTransitionBody = Static<typeof LeadTransitionBodySchema>;
export type LeadAssignmentBody = Static<typeof LeadAssignmentBodySchema>;
export type LeadConversionBody = Static<typeof LeadConversionBodySchema>;
