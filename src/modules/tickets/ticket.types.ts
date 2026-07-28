import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { TicketStatus } from "../../common/state-machines/ticket-transitions.js";

export const TICKET_TYPES = [
  "incident",
  "bug",
  "service_request",
  "improvement_request",
  "question",
  "change",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketCommentVisibility = "internal" | "client";

export interface TicketRecord {
  readonly id: string;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly requesterUserId: string;
  readonly assignedToUserId: string | null;
  readonly code: string;
  readonly type: TicketType;
  readonly requestedPriority: TicketPriority;
  readonly priority: TicketPriority;
  readonly status: TicketStatus;
  readonly subject: string;
  readonly description: string;
  readonly resolution: string | null;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TicketCreateInput {
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly type: TicketType;
  readonly requestedPriority?: TicketPriority;
  readonly subject: string;
  readonly description: string;
}

export interface TicketPatch {
  readonly subject?: string;
  readonly description?: string;
  readonly requestedPriority?: TicketPriority;
  readonly expectedUpdatedAt?: Date;
}

export interface TicketListInput extends PaginationInput {
  readonly search?: string;
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly requesterUserId?: string;
  readonly assignedToUserId?: string;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly updatedFrom?: Date;
  readonly updatedTo?: Date;
  readonly sortBy: "createdAt" | "updatedAt" | "code" | "priority" | "status";
  readonly sortDirection: "asc" | "desc";
}

export interface TicketCommentRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly organizationId: string | null;
  readonly authorUserId: string;
  readonly visibility: TicketCommentVisibility;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type TicketWriteResult<T> =
  | T
  | "not_found"
  | "conflict"
  | "ineligible_user"
  | "invalid_context"
  | "project_closed";

export interface TicketRepository {
  listAuthorized(scope: AuthorizedRepositoryScope, input: TicketListInput): Promise<PaginatedResult<TicketRecord>>;
  findAuthorized(scope: AuthorizedRepositoryScope, ticketId: string): Promise<TicketRecord | null>;
  create(
    scope: AuthorizedRepositoryScope,
    input: TicketCreateInput,
    requesterUserId: string,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>>;
  update(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    input: TicketPatch,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>>;
  assign(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    assignedToUserId: string | null,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>>;
  changePriority(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    priority: TicketPriority,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>>;
  transition(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    currentStatus: TicketStatus,
    nextStatus: TicketStatus,
    resolution: string | undefined,
    reason: string | undefined,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>>;
  confirmResolution(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    decision: "confirm" | "reject",
    reason: string | undefined,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketRecord>>;
  listComments(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    includeInternal: boolean,
  ): Promise<readonly TicketCommentRecord[] | null>;
  createComment(
    scope: AuthorizedRepositoryScope,
    ticketId: string,
    authorUserId: string,
    visibility: TicketCommentVisibility,
    content: string,
    audit: AuditContext,
  ): Promise<TicketWriteResult<TicketCommentRecord>>;
}
