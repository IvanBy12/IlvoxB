import { Type, type Static } from "@sinclair/typebox";

export const InternalInvitationParamsSchema = Type.Object({
  invitationId: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export const InternalInvitationCreateBodySchema = Type.Object({
  email: Type.String({ format: "email", maxLength: 320 }),
  roleCode: Type.String({ minLength: 1, maxLength: 80 }),
}, { additionalProperties: false });

export const InternalInvitationClaimBodySchema = Type.Object({
  invitationId: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

const InternalRoleSchema = Type.Object({
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });

const InternalInvitationSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  email: Type.String({ format: "email" }),
  roleCode: Type.String(),
  roleName: Type.String(),
  status: Type.Union([
    Type.Literal("pending"), Type.Literal("accepted"), Type.Literal("revoked"), Type.Literal("expired"),
  ]),
  invitedByUserId: Type.String({ format: "uuid" }),
  acceptedByUserId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  expiresAt: Type.String({ format: "date-time" }),
  acceptedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  revokedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const InternalRolesResponseSchema = Type.Object({
  data: Type.Array(InternalRoleSchema),
}, { additionalProperties: false });

export const InternalInvitationsResponseSchema = Type.Object({
  data: Type.Array(InternalInvitationSchema),
}, { additionalProperties: false });

export const InternalInvitationCreateResponseSchema = Type.Object({
  data: Type.Object({
    invitation: InternalInvitationSchema,
    outcome: Type.Union([Type.Literal("invitation_sent"), Type.Literal("existing_account_granted")]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const InternalInvitationResponseSchema = Type.Object({
  data: InternalInvitationSchema,
}, { additionalProperties: false });

export const InternalInvitationClaimResponseSchema = Type.Object({
  data: Type.Object({
    invitation: InternalInvitationSchema,
    alreadyClaimed: Type.Boolean(),
    audience: Type.Literal("internal"),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export type InternalInvitationParams = Static<typeof InternalInvitationParamsSchema>;
export type InternalInvitationCreateBody = Static<typeof InternalInvitationCreateBodySchema>;
export type InternalInvitationClaimBody = Static<typeof InternalInvitationClaimBodySchema>;
