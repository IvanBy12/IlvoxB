import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("docs", "openapi.json");
const document = JSON.parse(await readFile(target, "utf8"));
document.info.version = "0.8.4";
document.info.description = "Fase 8D.2: invitaciones privadas de personal interno, roles asignables y claim separado del acceso cliente.";
document.tags = [...document.tags.filter((tag) => tag.name !== "Internal Invitations"), { name: "Internal Invitations" }];

const response = (name) => ({ $ref: `#/components/responses/${name}` });
const secured = { security: [{ clerkSession: [] }], "x-permission": "users.manage", "x-audience": "internal" };
const invitationId = { name: "invitationId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const adminResponses = { "200": response("Success"), "400": response("ValidationError"), "401": response("Unauthenticated"), "403": response("Forbidden"), "404": response("NotFound"), "409": response("Conflict") };

document.paths["/internal-roles"] = {
  get: {
    tags: ["Internal Invitations"], summary: "List internal roles assignable by the current actor",
    description: "Returns global internal roles whose effective permissions do not exceed the inviter's capabilities. super_admin and client roles are excluded.",
    ...secured, responses: adminResponses,
  },
};
document.paths["/internal-invitations"] = {
  get: { tags: ["Internal Invitations"], summary: "List internal staff invitations", ...secured, responses: adminResponses },
  post: {
    tags: ["Internal Invitations"], summary: "Invite one internal collaborator", ...secured,
    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InternalInvitationCreate" } } } },
    responses: { ...adminResponses, "201": response("Success") },
  },
};
document.paths["/internal-invitations/{invitationId}/resend"] = {
  post: {
    tags: ["Internal Invitations"], summary: "Replace and resend an internal invitation", ...secured,
    "x-rate-limit": "5 per hour", parameters: [invitationId], responses: adminResponses,
  },
};
document.paths["/internal-invitations/{invitationId}/revoke"] = {
  post: { tags: ["Internal Invitations"], summary: "Revoke an internal invitation idempotently", ...secured, parameters: [invitationId], responses: adminResponses },
};
document.paths["/internal-invitations/claim"] = {
  post: {
    tags: ["Internal Invitations"], summary: "Claim an internal invitation with the authenticated Clerk identity",
    description: "Accepts only the opaque local invitation UUID. The role is read from PostgreSQL. This endpoint never creates an organization membership.",
    security: [{ clerkSession: [] }], "x-rate-limit": "10 per minute", "x-success-audience": "internal",
    "x-separated-from": "/client-invitations/claim",
    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InternalInvitationClaim" } } } },
    responses: adminResponses,
  },
};

Object.assign(document.components.schemas, {
  AssignableInternalRole: {
    type: "object", additionalProperties: false, required: ["code", "name", "description"],
    properties: { code: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] } },
  },
  InternalInvitationStatus: { type: "string", enum: ["pending", "accepted", "expired", "revoked"] },
  InternalInvitation: {
    type: "object", additionalProperties: false,
    required: ["id", "email", "roleCode", "roleName", "status", "invitedByUserId", "acceptedByUserId", "expiresAt", "acceptedAt", "revokedAt", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string", format: "uuid" }, email: { type: "string", format: "email" },
      roleCode: { type: "string" }, roleName: { type: "string" }, status: { $ref: "#/components/schemas/InternalInvitationStatus" },
      invitedByUserId: { type: "string", format: "uuid" }, acceptedByUserId: { type: ["string", "null"], format: "uuid" },
      expiresAt: { type: "string", format: "date-time" }, acceptedAt: { type: ["string", "null"], format: "date-time" },
      revokedAt: { type: ["string", "null"], format: "date-time" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
    },
  },
  InternalInvitationCreate: {
    type: "object", additionalProperties: false, required: ["email", "roleCode"],
    properties: { email: { type: "string", format: "email", maxLength: 320 }, roleCode: { type: "string", maxLength: 80 } },
  },
  InternalInvitationClaim: {
    type: "object", additionalProperties: false, required: ["invitationId"],
    properties: { invitationId: { type: "string", format: "uuid" } },
  },
});

await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version: document.info.version, internalInvitationOperations: 6 }));
