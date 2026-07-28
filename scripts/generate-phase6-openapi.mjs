import "./generate-phase5-openapi.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("docs", "openapi.json");
const document = JSON.parse(await readFile(target, "utf8"));
document.info.version = "0.6.0";
document.info.description =
  "Fase 6: tickets standalone, organizacionales y de proyecto; asignación, prioridad, transiciones, confirmación y comentarios con scopes SQL. No incluye archivos, almacenamiento, notificaciones, SLA ni frontend.";
document.tags = [
  ...document.tags.filter((tag) => !["Tickets", "Ticket Comments"].includes(tag.name)),
  { name: "Tickets" },
  { name: "Ticket Comments" },
];

const response = (name) => ({ $ref: `#/components/responses/${name}` });
const parameter = (name) => ({ $ref: `#/components/parameters/${name}` });
const query = (name, schema, description) => ({
  name,
  in: "query",
  schema,
  ...(description === undefined ? {} : { description }),
});
const operation = ({ tags, summary, description, permission, scope, parameters = [], body, created = false }) => ({
  tags,
  summary,
  description,
  security: [{ clerkSession: [] }],
  "x-permission": permission,
  "x-scope": scope,
  ...(parameters.length === 0 ? {} : { parameters }),
  ...(body === undefined ? {} : {
    requestBody: {
      required: true,
      content: { "application/json": { schema: { $ref: `#/components/schemas/${body}` } } },
    },
  }),
  responses: {
    [created ? "201" : "200"]: response("Success"),
    "400": response("ValidationError"),
    "401": response("Unauthenticated"),
    "403": response("Forbidden"),
    "404": response("NotFound"),
    "409": response("Conflict"),
  },
});

const ticketId = parameter("TicketId");
const readScope =
  "SQL before count/data: explicit global grant OR active organization membership OR active project membership OR current assignee OR requester; organization_id NULL only matches its requester";
const writeScope =
  "SQL-scoped ticket plus operation permission; missing and out-of-scope resources both return 404";

document.paths["/tickets"] = {
  get: operation({
    tags: ["Tickets"],
    summary: "List authorized tickets",
    description:
      "The identical scope predicate applies to filters, search, count, ordering and pagination. No files or download URLs are returned.",
    permission: "tickets.read (active local users also have own scope)",
    scope: readScope,
    parameters: [
      parameter("Page"),
      parameter("PageSize"),
      parameter("Search"),
      query("status", { $ref: "#/components/schemas/TicketStatus" }),
      query("priority", { $ref: "#/components/schemas/Priority" }),
      query("organizationId", { type: "string", format: "uuid" }),
      query("projectId", { type: "string", format: "uuid" }),
      query("requesterUserId", { type: "string", format: "uuid" }),
      query("assignedToUserId", { type: "string", format: "uuid" }),
      query("createdFrom", { type: "string", format: "date-time" }),
      query("createdTo", { type: "string", format: "date-time" }),
      query("updatedFrom", { type: "string", format: "date-time" }),
      query("updatedTo", { type: "string", format: "date-time" }),
      query("sortBy", {
        type: "string",
        enum: ["createdAt", "updatedAt", "code", "priority", "status"],
        default: "createdAt",
      }, "Whitelist only."),
      query("sortDirection", { type: "string", enum: ["asc", "desc"], default: "desc" }),
    ],
  }),
  post: operation({
    tags: ["Tickets"],
    summary: "Create a ticket",
    description:
      "Omit organizationId/projectId for a private standalone ticket. A project derives organizationId. The server owns requester, code, number, year, initial status, assignment, confirmations and timestamps.",
    permission: "tickets.create (active local users also have standalone own scope)",
    scope: "Standalone own, active organization membership, active project membership, or explicit global grant",
    body: "TicketCreate",
    created: true,
  }),
};
document.paths["/tickets/{ticketId}"] = {
  get: operation({
    tags: ["Tickets"],
    summary: "Get an authorized ticket",
    description: "Returns 404 for missing or out-of-scope tickets. Does not include files or comments.",
    permission: "tickets.read",
    scope: readScope,
    parameters: [ticketId],
  }),
  patch: operation({
    tags: ["Tickets"],
    summary: "Update general ticket fields",
    description:
      "Only subject, description and requestedPriority are accepted. Context, requester, assignment, priority, status, resolution, confirmation and system fields are protected. expectedUpdatedAt is optimistic concurrency.",
    permission: "tickets.update",
    scope: writeScope,
    parameters: [ticketId],
    body: "TicketPatch",
  }),
};
document.paths["/tickets/{ticketId}/assign"] = {
  post: operation({
    tags: ["Tickets"],
    summary: "Assign or unassign a ticket",
    description: "The target UUID must identify an active internal local user. The row is locked and audited.",
    permission: "tickets.assign",
    scope: writeScope,
    parameters: [ticketId],
    body: "TicketAssign",
  }),
};
document.paths["/tickets/{ticketId}/priority"] = {
  post: operation({
    tags: ["Tickets"],
    summary: "Change operational priority",
    description: "Requested priority remains separate. The row is locked and the mutation is audited.",
    permission: "tickets.change_priority",
    scope: writeScope,
    parameters: [ticketId],
    body: "TicketPriorityChange",
  }),
};
document.paths["/tickets/{ticketId}/transition"] = {
  post: operation({
    tags: ["Tickets"],
    summary: "Transition ticket state",
    description:
      "Uses the exact nine-state PostgreSQL machine. Resolution requires resolution text; cancellation and reopening require reason. Clients cannot choose arbitrary states.",
    permission: "tickets.change_status, tickets.resolve, or tickets.close according to target",
    scope: writeScope,
    parameters: [ticketId],
    body: "TicketTransition",
  }),
};
document.paths["/tickets/{ticketId}/confirm"] = {
  post: operation({
    tags: ["Tickets"],
    summary: "Confirm or reject a resolution",
    description:
      "Only resolved tickets are accepted. confirm closes; reject requires a reason and reopens. The requester is derived from the ticket and never from the body.",
    permission: "tickets.confirm_resolution or tickets.reject_resolution",
    scope: "Own requester, active organization scope, or explicit global grant; SQL-scoped",
    parameters: [ticketId],
    body: "TicketConfirm",
  }),
};
document.paths["/tickets/{ticketId}/reopen"] = {
  post: operation({
    tags: ["Tickets"],
    summary: "Request a controlled ticket reopen",
    description:
      "Only a closed authorized ticket is accepted. The server selects reopened; a non-empty reason is mandatory.",
    permission: "tickets.request_reopen",
    scope: "Own requester, active organization scope, or explicit global grant; SQL-scoped",
    parameters: [ticketId],
    body: "TicketReopen",
  }),
};
document.paths["/tickets/{ticketId}/comments"] = {
  get: operation({
    tags: ["Ticket Comments"],
    summary: "List authorized ticket comments",
    description:
      "The parent ticket must pass SQL scope. Actors without ticket_comments.read_internal receive only client-visible comments.",
    permission: "tickets.read; internal visibility additionally requires ticket_comments.read_internal",
    scope: readScope,
    parameters: [ticketId],
  }),
  post: operation({
    tags: ["Ticket Comments"],
    summary: "Create an immutable ticket comment",
    description:
      "Author, ticket and organization are server-owned. Clients are forced to client visibility. Content is plain text, limited to 10000 characters, and omitted from audit payloads.",
    permission: "ticket_comments.create_client or ticket_comments.create_internal",
    scope: "Inherited from the authorized parent ticket",
    parameters: [ticketId],
    body: "TicketCommentCreate",
    created: true,
  }),
};

Object.assign(document.components.parameters, {
  TicketId: {
    name: "ticketId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
});

const ticketStatuses = [
  "new", "classifying", "assigned", "in_progress", "pending_client",
  "resolved", "closed", "reopened", "cancelled",
];
Object.assign(document.components.schemas, {
  TicketStatus: { type: "string", enum: ticketStatuses },
  TicketType: {
    type: "string",
    enum: ["incident", "bug", "service_request", "improvement_request", "question", "change"],
  },
  TicketCreate: {
    type: "object",
    additionalProperties: false,
    required: ["type", "subject", "description"],
    properties: {
      organizationId: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      type: { $ref: "#/components/schemas/TicketType" },
      requestedPriority: { $ref: "#/components/schemas/Priority" },
      subject: { type: "string", minLength: 1, maxLength: 240 },
      description: { type: "string", minLength: 1, maxLength: 10000 },
    },
  },
  TicketPatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      subject: { type: "string", minLength: 1, maxLength: 240 },
      description: { type: "string", minLength: 1, maxLength: 10000 },
      requestedPriority: { $ref: "#/components/schemas/Priority" },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
  },
  TicketAssign: {
    type: "object",
    additionalProperties: false,
    required: ["assignedToUserId"],
    properties: {
      assignedToUserId: { type: ["string", "null"], format: "uuid" },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
  },
  TicketPriorityChange: {
    type: "object",
    additionalProperties: false,
    required: ["priority"],
    properties: {
      priority: { $ref: "#/components/schemas/Priority" },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
  },
  TicketTransition: {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: { $ref: "#/components/schemas/TicketStatus" },
      resolution: { type: "string", minLength: 1, maxLength: 10000 },
      reason: { type: "string", minLength: 1, maxLength: 500 },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
  },
  TicketConfirm: {
    type: "object",
    additionalProperties: false,
    required: ["decision"],
    properties: {
      decision: { type: "string", enum: ["confirm", "reject"] },
      reason: { type: "string", minLength: 1, maxLength: 500 },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
  },
  TicketCommentCreate: {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
      content: { type: "string", minLength: 1, maxLength: 10000 },
      visibility: { type: "string", enum: ["internal", "client"] },
    },
  },
  TicketReopen: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: {
      reason: { type: "string", minLength: 1, maxLength: 500 },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
  },
});

const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const operationCount = Object.values(document.paths)
  .flatMap((path) => Object.keys(path))
  .filter((method) => methods.has(method))
  .length;
if (operationCount !== 55) throw new Error(`Expected 55 operations, found ${operationCount}`);
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version: document.info.version, operationCount }));
