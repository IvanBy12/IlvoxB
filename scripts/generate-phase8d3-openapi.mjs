import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("docs", "openapi.json");
const document = JSON.parse(await readFile(target, "utf8"));
document.info.version = "0.8.5";
document.info.description = "Fase 8D.3: administración básica de colaboradores internos, estados, roles y permisos efectivos.";

const response = (name) => ({ $ref: `#/components/responses/${name}` });
const secured = { security: [{ clerkSession: [] }], "x-permission": "users.manage", "x-audience": "internal" };
const userId = { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const roleCode = { name: "roleCode", in: "path", required: true, schema: { type: "string", maxLength: 64 } };
const responses = { "200": response("Success"), "400": response("ValidationError"), "401": response("Unauthenticated"), "403": response("Forbidden"), "404": response("NotFound"), "409": response("Conflict") };

document.paths["/users"].get.description = "Returns the paginated local authorization catalog. Personal uses type=internal. No Clerk identifiers are exposed and lastAccessAt remains null until real tracking exists.";
document.paths["/users/{userId}"].get.description = "Returns one internal collaborator with internal roles, effective PostgreSQL permissions, dual-access indicator and identity synchronization state.";
document.paths["/users/{userId}/activate"] = { post: { tags: ["Users"], summary: "Activate or reactivate an internal collaborator", description: "Allows pending to active and blocked to active. Active is idempotent; deleted is terminal.", ...secured, parameters: [userId], responses } };
document.paths["/users/{userId}/block"] = { post: { tags: ["Users"], summary: "Block an internal collaborator", description: "Blocks active internal access without deleting history or client memberships. Protects the last active administrator by effective users.manage capability.", ...secured, parameters: [userId], responses } };
document.paths["/users/{userId}/roles"] = { post: { tags: ["Users"], summary: "Grant an assignable internal role", description: "Only existing global roles within the actor's effective capabilities. super_admin and client roles are excluded.", ...secured, parameters: [userId], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InternalUserRoleGrant" } } } }, responses } };
document.paths["/users/{userId}/roles/{roleCode}"] = { delete: { tags: ["Users"], summary: "Revoke an internal role idempotently", description: "Preserves at least one internal role and one active administrator with users.manage. super_admin changes are outside Personal.", ...secured, parameters: [userId, roleCode], responses } };

const user = document.components.schemas.UserCatalogItem;
for (const required of ["internalRoles", "hasClientAccess"]) if (!user.required.includes(required)) user.required.push(required);
user.properties.internalRoles = { type: "array", items: { type: "string" } };
user.properties.hasClientAccess = { type: "boolean" };
Object.assign(document.components.schemas, {
  UserCatalogSummary: { type: "object", additionalProperties: false, required: ["active", "pending", "blocked", "deleted"], properties: { active: { type: "integer", minimum: 0 }, pending: { type: "integer", minimum: 0 }, blocked: { type: "integer", minimum: 0 }, deleted: { type: "integer", minimum: 0 } } },
  UserCatalogDetail: { allOf: [{ $ref: "#/components/schemas/UserCatalogItem" }, { type: "object", required: ["identitySynchronized", "effectivePermissions"], properties: { identitySynchronized: { type: "boolean" }, effectivePermissions: { type: "array", items: { type: "string" } } } }] },
  InternalUserRoleGrant: { type: "object", additionalProperties: false, required: ["roleCode"], properties: { roleCode: { type: "string", minLength: 1, maxLength: 64 } } },
  InternalUserMutationResult: { type: "object", additionalProperties: false, required: ["kind", "user"], properties: { kind: { type: "string", enum: ["changed", "unchanged"] }, user: { $ref: "#/components/schemas/UserCatalogDetail" } } },
});

await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version: document.info.version, personalOperations: 7 }));
