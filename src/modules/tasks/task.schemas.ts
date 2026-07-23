import { Type, type Static } from "@sinclair/typebox";
import { TASK_STATUSES } from "../../common/state-machines/task-transitions.js";
import { PROJECT_PRIORITIES } from "../projects/project.types.js";

const literalUnion = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));

export const TaskIdParamsSchema = Type.Object({
  taskId: Type.String({ format: "uuid" }),
});
export const TaskListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  status: Type.Optional(literalUnion(TASK_STATUSES)),
  organizationId: Type.Optional(Type.String({ format: "uuid" })),
  projectId: Type.Optional(Type.String({ format: "uuid" })),
  assignedToUserId: Type.Optional(Type.String({ format: "uuid" })),
  createdByUserId: Type.Optional(Type.String({ format: "uuid" })),
  dueFrom: Type.Optional(Type.String({ format: "date" })),
  dueTo: Type.Optional(Type.String({ format: "date" })),
  sortBy: Type.Optional(literalUnion(["createdAt", "updatedAt", "title", "dueDate"] as const)),
  sortDirection: Type.Optional(literalUnion(["asc", "desc"] as const)),
});
export const TaskCreateBodySchema = Type.Object({
  projectId: Type.Optional(Type.String({ format: "uuid" })),
  title: Type.String({ minLength: 1, maxLength: 240 }),
  description: Type.String({ minLength: 1, maxLength: 10000 }),
  assignedToUserId: Type.String({ format: "uuid" }),
  priority: Type.Optional(literalUnion(PROJECT_PRIORITIES)),
  dueDate: Type.String({ format: "date" }),
  estimatedMinutes: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export const TaskPatchBodySchema = Type.Partial(Type.Object({
  title: Type.String({ minLength: 1, maxLength: 240 }),
  description: Type.String({ minLength: 1, maxLength: 10000 }),
  priority: literalUnion(PROJECT_PRIORITIES),
  dueDate: Type.String({ format: "date" }),
  estimatedMinutes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  expectedUpdatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false }), { minProperties: 1 });
export const TaskAssignBodySchema = Type.Object({
  assignedToUserId: Type.String({ format: "uuid" }),
  expectedUpdatedAt: Type.Optional(Type.String({ format: "date-time" })),
}, { additionalProperties: false });
export const TaskTransitionBodySchema = Type.Object({
  status: literalUnion(TASK_STATUSES),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, { additionalProperties: false });

export type TaskIdParams = Static<typeof TaskIdParamsSchema>;
export type TaskListQuery = Static<typeof TaskListQuerySchema>;
export type TaskCreateBody = Static<typeof TaskCreateBodySchema>;
export type TaskPatchBody = Static<typeof TaskPatchBodySchema>;
export type TaskAssignBody = Static<typeof TaskAssignBodySchema>;
export type TaskTransitionBody = Static<typeof TaskTransitionBodySchema>;
