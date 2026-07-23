import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("docs", "openapi.json");
const document = JSON.parse(await readFile(target, "utf8"));
document.info.version = "0.5.0";
document.info.description =
  "Contrato implementado de Fase 5: proyectos ligados a organizaciones, miembros, hitos, entregables y tareas internas o de proyecto. No incluye tickets, comentarios ni archivos.";
document.tags = [
  ...document.tags.filter((tag) =>
    !["Projects", "Project Members", "Milestones", "Deliverables", "Tasks"].includes(tag.name)),
  { name: "Projects" },
  { name: "Project Members" },
  { name: "Milestones" },
  { name: "Deliverables" },
  { name: "Tasks" },
];

const response = (name) => ({ $ref: `#/components/responses/${name}` });
const pathParameter = (name) => ({ $ref: `#/components/parameters/${name}` });
const queryParameter = (name, schema, description) => ({
  name,
  in: "query",
  ...(description === undefined ? {} : { description }),
  schema,
});
const requestBody = (schema) => ({
  required: true,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
});
const operation = ({
  tags,
  summary,
  description,
  permission,
  scope,
  parameters = [],
  body,
  created = false,
  conflict = false,
}) => ({
  tags,
  summary,
  description,
  security: [{ clerkSession: [] }],
  "x-permission": permission,
  "x-scope": scope,
  ...(parameters.length === 0 ? {} : { parameters }),
  ...(body === undefined ? {} : { requestBody: requestBody(body) }),
  responses: {
    [created ? "201" : "200"]: response("Success"),
    "400": response("ValidationError"),
    "401": response("Unauthenticated"),
    "403": response("Forbidden"),
    "404": response("NotFound"),
    ...(conflict ? { "409": response("Conflict") } : {}),
  },
});

const projectId = pathParameter("ProjectId");
const memberId = pathParameter("MemberId");
const milestoneId = pathParameter("MilestoneId");
const deliverableId = pathParameter("DeliverableId");
const taskId = pathParameter("TaskId");
const projectReadScope = "SQL: global OR organization_id granted OR active project membership";
const projectManageScope = "SQL: global/authorized project membership with projects.manage";
const taskReadScope =
  "SQL: global OR project membership OR standalone assignee/creator; organization_id NULL is never public";
const taskManageScope =
  "SQL: global OR authorized project membership; standalone creation requires internal global scope";

document.paths["/projects"] = {
  get: operation({
    tags: ["Projects"],
    summary: "List authorized projects",
    description: "The scope predicate is applied to search, filters, count, ordering and pagination.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [
      pathParameter("Page"),
      pathParameter("PageSize"),
      pathParameter("Search"),
      queryParameter("status", { $ref: "#/components/schemas/ProjectStatus" }),
      queryParameter("organizationId", { type: "string", format: "uuid" }),
      queryParameter("leadUserId", { type: "string", format: "uuid" }),
      queryParameter("startFrom", { type: "string", format: "date" }),
      queryParameter("dueTo", { type: "string", format: "date" }),
      queryParameter("sortBy", {
        type: "string",
        enum: ["createdAt", "updatedAt", "name", "startDate", "dueDate"],
        default: "createdAt",
      }, "Whitelist only."),
      queryParameter("sortDirection", { type: "string", enum: ["asc", "desc"], default: "desc" }),
    ],
  }),
  post: operation({
    tags: ["Projects"],
    summary: "Create an organization-bound project",
    description:
      "Organization and active internal lead are validated in scope. The server forces planning and never creates organizations or memberships.",
    permission: "projects.manage",
    scope: "Authorized organization; project organization is mandatory and immutable",
    body: "ProjectCreate",
    created: true,
  }),
};
document.paths["/projects/{projectId}"] = {
  get: operation({
    tags: ["Projects"],
    summary: "Get an authorized project",
    description: "Returns 404 for missing or out-of-scope projects.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [projectId],
  }),
  patch: operation({
    tags: ["Projects"],
    summary: "Update general project data",
    description:
      "Status, lead and organization are protected. expectedUpdatedAt enables optimistic conflict detection.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId],
    body: "ProjectPatch",
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/assign"] = {
  post: operation({
    tags: ["Projects"],
    summary: "Assign the project lead",
    description: "The target must be an active internal local user. Assignment is transactional and audited.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId],
    body: "ProjectAssign",
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/transition"] = {
  post: operation({
    tags: ["Projects"],
    summary: "Transition project status",
    description:
      "Uses the server state machine, row lock and observed status. Delivery requires all milestones completed and all deliverables approved; terminal exits require administrator and reason.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId],
    body: "ProjectTransition",
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/members"] = {
  get: operation({
    tags: ["Project Members"],
    summary: "List project members",
    description: "Membership is read only after the parent project passes SQL scope.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [projectId],
  }),
  post: operation({
    tags: ["Project Members"],
    summary: "Add a project member",
    description:
      "Uses only project roles. Internal users need no organization membership; client users require an active membership in the project organization.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId],
    body: "ProjectMemberCreate",
    created: true,
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/members/{memberId}"] = {
  patch: operation({
    tags: ["Project Members"],
    summary: "Change a project member role",
    description:
      "Only project_lead, project_member or project_viewer are accepted. Revocation is not exposed because the current schema cannot preserve it.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId, memberId],
    body: "ProjectMemberPatch",
  }),
};
document.paths["/projects/{projectId}/milestones"] = {
  get: operation({
    tags: ["Milestones"],
    summary: "List project milestones",
    description: "The authorized parent project scopes the query.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [projectId],
  }),
  post: operation({
    tags: ["Milestones"],
    summary: "Create a project milestone",
    description: "Organization is derived from the locked project; due date must be inside its date range.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId],
    body: "MilestoneCreate",
    created: true,
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/milestones/{milestoneId}"] = {
  get: operation({
    tags: ["Milestones"],
    summary: "Get a project milestone",
    description: "Both project and milestone identifiers are checked without cross-scope disclosure.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [projectId, milestoneId],
  }),
  patch: operation({
    tags: ["Milestones"],
    summary: "Update a project milestone",
    description:
      "Status is limited to SQL values; completedAt is server-owned. expectedUpdatedAt detects concurrent updates.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId, milestoneId],
    body: "MilestonePatch",
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/deliverables"] = {
  get: operation({
    tags: ["Deliverables"],
    summary: "List project deliverables",
    description: "Does not return files or storage URLs.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [projectId],
  }),
  post: operation({
    tags: ["Deliverables"],
    summary: "Create a project deliverable",
    description:
      "Organization is derived from the project. Milestone association is intentionally unavailable in the current schema.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId],
    body: "DeliverableCreate",
    created: true,
    conflict: true,
  }),
};
document.paths["/projects/{projectId}/deliverables/{deliverableId}"] = {
  get: operation({
    tags: ["Deliverables"],
    summary: "Get a project deliverable",
    description: "Does not include files.",
    permission: "projects.read",
    scope: projectReadScope,
    parameters: [projectId, deliverableId],
  }),
  patch: operation({
    tags: ["Deliverables"],
    summary: "Update a project deliverable",
    description:
      "Approval identity and timestamp are server-owned. expectedUpdatedAt detects concurrent updates.",
    permission: "projects.manage",
    scope: projectManageScope,
    parameters: [projectId, deliverableId],
    body: "DeliverablePatch",
    conflict: true,
  }),
};
document.paths["/tasks"] = {
  get: operation({
    tags: ["Tasks"],
    summary: "List authorized project and standalone tasks",
    description:
      "Ticket tasks are excluded. Scope is applied to filters, search, count, ordering and pagination.",
    permission: "tasks.read",
    scope: taskReadScope,
    parameters: [
      pathParameter("Page"),
      pathParameter("PageSize"),
      pathParameter("Search"),
      queryParameter("status", { $ref: "#/components/schemas/TaskStatus" }),
      queryParameter("organizationId", { type: "string", format: "uuid" }),
      queryParameter("projectId", { type: "string", format: "uuid" }),
      queryParameter("assignedToUserId", { type: "string", format: "uuid" }),
      queryParameter("createdByUserId", { type: "string", format: "uuid" }),
      queryParameter("dueFrom", { type: "string", format: "date" }),
      queryParameter("dueTo", { type: "string", format: "date" }),
      queryParameter("sortBy", {
        type: "string",
        enum: ["createdAt", "updatedAt", "title", "dueDate"],
        default: "createdAt",
      }, "Whitelist only."),
      queryParameter("sortDirection", { type: "string", enum: ["asc", "desc"], default: "desc" }),
    ],
  }),
  post: operation({
    tags: ["Tasks"],
    summary: "Create a project or internal standalone task",
    description:
      "Project organization is derived from projectId. Omitting projectId creates a private standalone task and requires internal global scope. ticketId and organizationId are rejected.",
    permission: "tasks.manage",
    scope: taskManageScope,
    body: "TaskCreate",
    created: true,
    conflict: true,
  }),
};
document.paths["/tasks/{taskId}"] = {
  get: operation({
    tags: ["Tasks"],
    summary: "Get an authorized task",
    description: "Returns 404 for missing or out-of-scope tasks and never exposes ticket tasks.",
    permission: "tasks.read",
    scope: taskReadScope,
    parameters: [taskId],
  }),
  patch: operation({
    tags: ["Tasks"],
    summary: "Update general task data",
    description:
      "Context, assignee and status are protected. expectedUpdatedAt enables optimistic conflict detection.",
    permission: "tasks.manage",
    scope: taskManageScope,
    parameters: [taskId],
    body: "TaskPatch",
    conflict: true,
  }),
};
document.paths["/tasks/{taskId}/assign"] = {
  post: operation({
    tags: ["Tasks"],
    summary: "Assign a task",
    description:
      "Project tasks require an active project member; standalone tasks require an active internal local user. The row is locked and audited.",
    permission: "tasks.manage",
    scope: taskManageScope,
    parameters: [taskId],
    body: "TaskAssign",
    conflict: true,
  }),
};
document.paths["/tasks/{taskId}/transition"] = {
  post: operation({
    tags: ["Tasks"],
    summary: "Transition task status",
    description:
      "Uses the seven-state server machine, assignee/leader guards, reasons for terminal changes, row lock and observed status.",
    permission: "tasks.manage",
    scope: taskManageScope,
    parameters: [taskId],
    body: "TaskTransition",
    conflict: true,
  }),
};

Object.assign(document.components.parameters, {
  ProjectId: {
    name: "projectId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  MilestoneId: {
    name: "milestoneId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  DeliverableId: {
    name: "deliverableId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  TaskId: {
    name: "taskId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
});

const optionalTimestamp = { type: "string", format: "date-time" };
Object.assign(document.components.schemas, {
  ProjectStatus: {
    type: "string",
    enum: ["planning", "in_progress", "paused", "in_review", "delivered", "cancelled"],
  },
  TaskStatus: {
    type: "string",
    enum: ["pending", "ready", "in_progress", "blocked", "in_review", "completed", "cancelled"],
  },
  Priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
  ProjectCreate: {
    type: "object",
    additionalProperties: false,
    required: ["organizationId", "name", "description", "leadUserId", "startDate", "dueDate"],
    properties: {
      organizationId: { type: "string", format: "uuid" },
      serviceId: { type: "string", format: "uuid" },
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", minLength: 1, maxLength: 10000 },
      priority: { $ref: "#/components/schemas/Priority" },
      leadUserId: { type: "string", format: "uuid" },
      startDate: { type: "string", format: "date" },
      dueDate: { type: "string", format: "date" },
    },
  },
  ProjectPatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      serviceId: { type: ["string", "null"], format: "uuid" },
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", minLength: 1, maxLength: 10000 },
      priority: { $ref: "#/components/schemas/Priority" },
      startDate: { type: "string", format: "date" },
      dueDate: { type: "string", format: "date" },
      expectedUpdatedAt: optionalTimestamp,
    },
  },
  ProjectAssign: {
    type: "object",
    additionalProperties: false,
    required: ["leadUserId"],
    properties: {
      leadUserId: { type: "string", format: "uuid" },
      expectedUpdatedAt: optionalTimestamp,
    },
  },
  ProjectTransition: {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: { $ref: "#/components/schemas/ProjectStatus" },
      reason: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
  ProjectMemberCreate: {
    type: "object",
    additionalProperties: false,
    required: ["userId", "roleCode"],
    properties: {
      userId: { type: "string", format: "uuid" },
      roleCode: { type: "string", enum: ["project_lead", "project_member", "project_viewer"] },
    },
  },
  ProjectMemberPatch: {
    type: "object",
    additionalProperties: false,
    required: ["roleCode"],
    properties: {
      roleCode: { type: "string", enum: ["project_lead", "project_member", "project_viewer"] },
    },
  },
  MilestoneCreate: {
    type: "object",
    additionalProperties: false,
    required: ["name", "dueDate"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 10000 },
      dueDate: { type: "string", format: "date" },
    },
  },
  MilestonePatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: ["string", "null"], maxLength: 10000 },
      status: { type: "string", enum: ["pending", "in_progress", "completed"] },
      dueDate: { type: "string", format: "date" },
      expectedUpdatedAt: optionalTimestamp,
    },
  },
  DeliverableCreate: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 10000 },
    },
  },
  DeliverablePatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: ["string", "null"], maxLength: 10000 },
      status: {
        type: "string",
        enum: ["pending", "in_review", "delivered", "approved", "rejected"],
      },
      expectedUpdatedAt: optionalTimestamp,
    },
  },
  TaskCreate: {
    type: "object",
    additionalProperties: false,
    required: ["title", "description", "assignedToUserId", "dueDate"],
    properties: {
      projectId: { type: "string", format: "uuid" },
      title: { type: "string", minLength: 1, maxLength: 240 },
      description: { type: "string", minLength: 1, maxLength: 10000 },
      assignedToUserId: { type: "string", format: "uuid" },
      priority: { $ref: "#/components/schemas/Priority" },
      dueDate: { type: "string", format: "date" },
      estimatedMinutes: { type: "integer", minimum: 0 },
    },
  },
  TaskPatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 240 },
      description: { type: "string", minLength: 1, maxLength: 10000 },
      priority: { $ref: "#/components/schemas/Priority" },
      dueDate: { type: "string", format: "date" },
      estimatedMinutes: { type: ["integer", "null"], minimum: 0 },
      expectedUpdatedAt: optionalTimestamp,
    },
  },
  TaskAssign: {
    type: "object",
    additionalProperties: false,
    required: ["assignedToUserId"],
    properties: {
      assignedToUserId: { type: "string", format: "uuid" },
      expectedUpdatedAt: optionalTimestamp,
    },
  },
  TaskTransition: {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: { $ref: "#/components/schemas/TaskStatus" },
      reason: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
});

const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const operationCount = Object.values(document.paths)
  .flatMap((path) => Object.keys(path))
  .filter((method) => methods.has(method))
  .length;
if (operationCount !== 43) throw new Error(`Expected 43 operations, found ${operationCount}`);
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version: document.info.version, operationCount }));
