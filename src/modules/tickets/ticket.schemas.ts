import { Type, type Static } from "@sinclair/typebox";
import { TICKET_STATUSES } from "../../common/state-machines/ticket-transitions.js";
import { TICKET_PRIORITIES, TICKET_TYPES } from "./ticket.types.js";

const literalUnion = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));

const ExpectedUpdatedAt = Type.Optional(Type.String({ format: "date-time" }));

export const TicketIdParamsSchema = Type.Object({
  ticketId: Type.String({ format: "uuid" }),
});
export const TicketListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  status: Type.Optional(literalUnion(TICKET_STATUSES)),
  priority: Type.Optional(literalUnion(TICKET_PRIORITIES)),
  organizationId: Type.Optional(Type.String({ format: "uuid" })),
  projectId: Type.Optional(Type.String({ format: "uuid" })),
  requesterUserId: Type.Optional(Type.String({ format: "uuid" })),
  assignedToUserId: Type.Optional(Type.String({ format: "uuid" })),
  createdFrom: Type.Optional(Type.String({ format: "date-time" })),
  createdTo: Type.Optional(Type.String({ format: "date-time" })),
  updatedFrom: Type.Optional(Type.String({ format: "date-time" })),
  updatedTo: Type.Optional(Type.String({ format: "date-time" })),
  sortBy: Type.Optional(literalUnion(["createdAt", "updatedAt", "code", "priority", "status"] as const)),
  sortDirection: Type.Optional(literalUnion(["asc", "desc"] as const)),
});
export const TicketCreateBodySchema = Type.Object({
  organizationId: Type.Optional(Type.String({ format: "uuid" })),
  projectId: Type.Optional(Type.String({ format: "uuid" })),
  type: literalUnion(TICKET_TYPES),
  requestedPriority: Type.Optional(literalUnion(TICKET_PRIORITIES)),
  subject: Type.String({ minLength: 1, maxLength: 240 }),
  description: Type.String({ minLength: 1, maxLength: 10000 }),
}, { additionalProperties: false });
export const TicketPatchBodySchema = Type.Partial(Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 240 }),
  description: Type.String({ minLength: 1, maxLength: 10000 }),
  requestedPriority: literalUnion(TICKET_PRIORITIES),
  expectedUpdatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false }), { minProperties: 1 });
export const TicketAssignBodySchema = Type.Object({
  assignedToUserId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const TicketPriorityBodySchema = Type.Object({
  priority: literalUnion(TICKET_PRIORITIES),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const TicketTransitionBodySchema = Type.Object({
  status: literalUnion(TICKET_STATUSES),
  resolution: Type.Optional(Type.String({ minLength: 1, maxLength: 10000 })),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const TicketConfirmBodySchema = Type.Object({
  decision: literalUnion(["confirm", "reject"] as const),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const TicketReopenBodySchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  expectedUpdatedAt: ExpectedUpdatedAt,
}, { additionalProperties: false });
export const TicketCommentCreateBodySchema = Type.Object({
  content: Type.String({ minLength: 1, maxLength: 10000 }),
  visibility: Type.Optional(literalUnion(["internal", "client"] as const)),
}, { additionalProperties: false });

export type TicketIdParams = Static<typeof TicketIdParamsSchema>;
export type TicketListQuery = Static<typeof TicketListQuerySchema>;
export type TicketCreateBody = Static<typeof TicketCreateBodySchema>;
export type TicketPatchBody = Static<typeof TicketPatchBodySchema>;
export type TicketAssignBody = Static<typeof TicketAssignBodySchema>;
export type TicketPriorityBody = Static<typeof TicketPriorityBodySchema>;
export type TicketTransitionBody = Static<typeof TicketTransitionBodySchema>;
export type TicketConfirmBody = Static<typeof TicketConfirmBodySchema>;
export type TicketReopenBody = Static<typeof TicketReopenBodySchema>;
export type TicketCommentCreateBody = Static<typeof TicketCommentCreateBodySchema>;
