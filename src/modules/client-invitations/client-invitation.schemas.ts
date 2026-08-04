import { Type, type Static } from "@sinclair/typebox";

const ClientRoleSchema = Type.Union([
  Type.Literal("client_manager"),
  Type.Literal("client_contact"),
]);

export const ClientInvitationOrganizationParamsSchema = Type.Object({
  organizationId: Type.String({ format: "uuid" }),
});

export const ClientInvitationParamsSchema = Type.Object({
  organizationId: Type.String({ format: "uuid" }),
  invitationId: Type.String({ format: "uuid" }),
});

export const ClientInvitationCreateBodySchema = Type.Object({
  email: Type.String({ format: "email", maxLength: 320 }),
  membershipRole: ClientRoleSchema,
});

export const ClientInvitationClaimBodySchema = Type.Object({
  invitationId: Type.String({ format: "uuid" }),
});

export type ClientInvitationOrganizationParams = Static<typeof ClientInvitationOrganizationParamsSchema>;
export type ClientInvitationParams = Static<typeof ClientInvitationParamsSchema>;
export type ClientInvitationCreateBody = Static<typeof ClientInvitationCreateBodySchema>;
export type ClientInvitationClaimBody = Static<typeof ClientInvitationClaimBodySchema>;
