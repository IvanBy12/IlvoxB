import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("docs", "openapi.json");
const document = JSON.parse(await readFile(target, "utf8"));
document.info.version = "0.8.3";
document.info.description = "Fase 8D.1: catálogo administrativo de usuarios y elegibilidad contextual calculada exclusivamente por PostgreSQL/RBAC.";
document.tags = [...document.tags.filter((tag) => tag.name !== "Users"), { name: "Users" }];

const response = (name) => ({ $ref: `#/components/responses/${name}` });
const secured = (permission) => ({ security: [{ clerkSession: [] }], "x-permission": permission });
const uuidPath = (name) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const query = (name, schema, required = false) => ({ name, in: "query", required, schema });
const commonResponses = { "200": response("Success"), "400": response("ValidationError"), "401": response("Unauthenticated"), "403": response("Forbidden"), "404": response("NotFound") };

document.paths["/users"] = {
  get: {
    tags: ["Users"], summary: "List the administrative local user catalog",
    description: "Returns local authorization data only. No Clerk identifiers or metadata are exposed. lastAccessAt is null until an existing access tracker is available.",
    ...secured("users.manage"),
    parameters: [
      query("page", { type: "integer", minimum: 1, default: 1 }),
      query("pageSize", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
      query("search", { type: "string", maxLength: 320 }),
      query("status", { type: "string", enum: ["pending", "active", "blocked", "deleted"] }),
      query("type", { type: "string", enum: ["internal", "client"] }),
      query("role", { type: "string", maxLength: 64 }),
      query("sortBy", { type: "string", enum: ["displayName", "email", "createdAt"] }),
      query("sortDirection", { type: "string", enum: ["asc", "desc"] }),
    ],
    responses: commonResponses,
  },
};
document.paths["/users/{userId}"] = {
  get: {
    tags: ["Users"], summary: "Get one local user catalog record", ...secured("users.manage"),
    parameters: [uuidPath("userId")], responses: commonResponses,
  },
};
document.paths["/users/eligible"] = {
  get: {
    tags: ["Users"], summary: "List eligible users for an operational purpose",
    description: "The server validates the purpose/context combination, resource scope, active status, internal/client boundary, memberships and effective RBAC. Ineligible identities are omitted.",
    security: [{ clerkSession: [] }],
    "x-permission": "Purpose-specific: organizations.manage, projects.manage, tasks.manage, tickets.assign, or leads.manage",
    "x-neutral-scope": "Out-of-scope organization, project, task, ticket, and lead contexts return 404",
    parameters: [
      query("purpose", { $ref: "#/components/schemas/EligibleUserPurpose" }, true),
      ...["organizationId", "projectId", "ticketId", "taskId", "leadId"].map((name) => query(name, { type: "string", format: "uuid" })),
      query("search", { type: "string", maxLength: 320 }),
    ],
    responses: commonResponses,
  },
};

Object.assign(document.components.schemas, {
  EligibleUserPurpose: { type: "string", enum: ["organization_account_manager", "project_lead", "project_member", "task_assignee", "ticket_assignee", "lead_assignee"] },
  UserCatalogItem: {
    type: "object", additionalProperties: false,
    required: ["id", "displayName", "email", "status", "isInternal", "roles", "createdAt", "lastAccessAt"],
    properties: {
      id: { type: "string", format: "uuid" }, displayName: { type: "string" }, email: { type: "string", format: "email" },
      status: { type: "string", enum: ["pending", "active", "blocked", "deleted"] }, isInternal: { type: "boolean" },
      roles: { type: "array", items: { type: "string" } }, createdAt: { type: "string", format: "date-time" }, lastAccessAt: { type: "null" },
    },
  },
  EligibleUser: {
    type: "object", additionalProperties: false, required: ["id", "displayName", "email", "roles"],
    properties: { id: { type: "string", format: "uuid" }, displayName: { type: "string" }, email: { type: "string", format: "email" }, roles: { type: "array", items: { type: "string" } } },
  },
});

await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version: document.info.version, userPaths: 3 }));
