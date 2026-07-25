import { Type, type Static } from "@sinclair/typebox";
import { DELIVERABLE_STATUSES, MILESTONE_STATUSES, PROJECT_PRIORITIES } from "./project.types.js";
import { PROJECT_STATUSES } from "../../common/state-machines/project-transitions.js";

const literalUnion = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));
const NullableText = Type.Union([Type.String({ maxLength: 10000 }), Type.Null()]);
const ExpectedUpdatedAt = Type.Optional(Type.String({ format: "date-time" }));

export const ProjectIdParamsSchema = Type.Object({
  projectId: Type.String({ format: "uuid" }),
});
export const ProjectMilestoneParamsSchema = Type.Object({
  projectId: Type.String({ format: "uuid" }),
  milestoneId: Type.String({ format: "uuid" }),
});
export const ProjectDeliverableParamsSchema = Type.Object({
  projectId: Type.String({ format: "uuid" }),
  deliverableId: Type.String({ format: "uuid" }),
});
export const ProjectMemberParamsSchema = Type.Object({
  projectId: Type.String({ format: "uuid" }),
  memberId: Type.String({ format: "uuid" }),
});
export const ProjectListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  status: Type.Optional(literalUnion(PROJECT_STATUSES)),
  organizationId: Type.Optional(Type.String({ format: "uuid" })),
  leadUserId: Type.Optional(Type.String({ format: "uuid" })),
  startFrom: Type.Optional(Type.String({ format: "date" })),
  dueTo: Type.Optional(Type.String({ format: "date" })),
  sortBy: Type.Optional(literalUnion(["createdAt", "updatedAt", "name", "startDate", "dueDate"] as const)),
  sortDirection: Type.Optional(literalUnion(["asc", "desc"] as const)),
});
export const ProjectCreateBodySchema = Type.Object({
  organizationId: Type.String({ format: "uuid" }),
  serviceId: Type.Optional(Type.String({ format: "uuid" })),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 10000 }),
  priority: Type.Optional(literalUnion(PROJECT_PRIORITIES)),
  leadUserId: Type.String({ format: "uuid" }),
  startDate: Type.String({ format: "date" }),
  dueDate: Type.String({ format: "date" }),
}, { additionalProperties: false });
export const ProjectPatchBodySchema = Type.Partial(Type.Object({
  serviceId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 10000 }),
  priority: literalUnion(PROJECT_PRIORITIES),
  startDate: Type.String({ format: "date" }),
  dueDate: Type.String({ format: "date" }),
  expectedUpdatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false }), { minProperties: 1 });
export const ProjectAssignBodySchema = Type.Object({
  leadUserId: Type.String({ format: "uuid" }),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const ProjectTransitionBodySchema = Type.Object({
  status: literalUnion(PROJECT_STATUSES),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, { additionalProperties: false });
export const ProjectMemberCreateBodySchema = Type.Object({
  userId: Type.String({ format: "uuid" }),
  roleCode: literalUnion(["project_lead", "project_member", "project_viewer"] as const),
}, { additionalProperties: false });
export const ProjectMemberPatchBodySchema = Type.Object({
  roleCode: literalUnion(["project_lead", "project_member", "project_viewer"] as const),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const ProjectMemberRevokeBodySchema = Type.Object({
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const MilestoneCreateBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 10000 })),
  dueDate: Type.String({ format: "date" }),
}, { additionalProperties: false });
export const MilestonePatchBodySchema = Type.Partial(Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: NullableText,
  status: literalUnion(MILESTONE_STATUSES),
  dueDate: Type.String({ format: "date" }),
  expectedUpdatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false }), { minProperties: 1 });
export const DeliverableCreateBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 10000 })),
  milestoneId: Type.Optional(Type.String({ format: "uuid" })),
}, { additionalProperties: false });
export const DeliverablePatchBodySchema = Type.Partial(Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: NullableText,
  milestoneId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  status: literalUnion(DELIVERABLE_STATUSES),
  expectedUpdatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false }), { minProperties: 1 });

export type ProjectIdParams = Static<typeof ProjectIdParamsSchema>;
export type ProjectMilestoneParams = Static<typeof ProjectMilestoneParamsSchema>;
export type ProjectDeliverableParams = Static<typeof ProjectDeliverableParamsSchema>;
export type ProjectMemberParams = Static<typeof ProjectMemberParamsSchema>;
export type ProjectListQuery = Static<typeof ProjectListQuerySchema>;
export type ProjectCreateBody = Static<typeof ProjectCreateBodySchema>;
export type ProjectPatchBody = Static<typeof ProjectPatchBodySchema>;
export type ProjectAssignBody = Static<typeof ProjectAssignBodySchema>;
export type ProjectTransitionBody = Static<typeof ProjectTransitionBodySchema>;
export type ProjectMemberCreateBody = Static<typeof ProjectMemberCreateBodySchema>;
export type ProjectMemberPatchBody = Static<typeof ProjectMemberPatchBodySchema>;
export type ProjectMemberRevokeBody = Static<typeof ProjectMemberRevokeBodySchema>;
export type MilestoneCreateBody = Static<typeof MilestoneCreateBodySchema>;
export type MilestonePatchBody = Static<typeof MilestonePatchBodySchema>;
export type DeliverableCreateBody = Static<typeof DeliverableCreateBodySchema>;
export type DeliverablePatchBody = Static<typeof DeliverablePatchBodySchema>;
