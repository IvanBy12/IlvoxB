import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import {
  canConfirmTicketResolution,
  canTransitionTicket,
  type TicketStatus,
} from "../../common/state-machines/ticket-transitions.js";
import type {
  TicketCommentVisibility,
  TicketCreateInput,
  TicketListInput,
  TicketPatch,
  TicketPriority,
  TicketRepository,
  TicketWriteResult,
} from "./ticket.types.js";

type TicketAction =
  | "tickets.read"
  | "tickets.create"
  | "tickets.update"
  | "tickets.assign"
  | "tickets.change_priority"
  | "tickets.change_status"
  | "tickets.resolve"
  | "tickets.close"
  | "tickets.confirm_resolution"
  | "tickets.reject_resolution"
  | "tickets.request_reopen"
  | "ticket_comments.read_internal"
  | "ticket_comments.create_client"
  | "ticket_comments.create_internal";

export class TicketService {
  constructor(
    private readonly repository: TicketRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  list(actor: ActorContext, input: TicketListInput) {
    return this.repository.listAuthorized(this.scope(actor, "tickets.read"), input);
  }

  async get(actor: ActorContext, ticketId: string) {
    const ticket = await this.repository.findAuthorized(this.scope(actor, "tickets.read"), ticketId);
    if (ticket === null) throw this.notFound();
    return ticket;
  }

  create(actor: ActorContext, input: TicketCreateInput, audit: AuditContext) {
    const standalone = input.organizationId === undefined && input.projectId === undefined;
    const scope = this.scope(actor, "tickets.create", standalone ? "own" : undefined);
    return this.unwrap(this.repository.create(scope, input, actor.localUserId, audit));
  }

  update(actor: ActorContext, ticketId: string, input: TicketPatch, audit: AuditContext) {
    return this.unwrap(this.repository.update(
      this.scope(actor, "tickets.update"),
      ticketId,
      input,
      audit,
    ));
  }

  assign(
    actor: ActorContext,
    ticketId: string,
    assignedToUserId: string | null,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.assign(
      this.scope(actor, "tickets.assign"),
      ticketId,
      assignedToUserId,
      expectedUpdatedAt,
      audit,
    ));
  }

  changePriority(
    actor: ActorContext,
    ticketId: string,
    priority: TicketPriority,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    return this.unwrap(this.repository.changePriority(
      this.scope(actor, "tickets.change_priority"),
      ticketId,
      priority,
      expectedUpdatedAt,
      audit,
    ));
  }

  async transition(
    actor: ActorContext,
    ticketId: string,
    nextStatus: TicketStatus,
    resolution: string | undefined,
    reason: string | undefined,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    const action: TicketAction = nextStatus === "resolved"
      ? "tickets.resolve"
      : nextStatus === "closed"
        ? "tickets.close"
        : "tickets.change_status";
    const scope = this.scope(actor, action);
    const ticket = await this.repository.findAuthorized(scope, ticketId);
    if (ticket === null) throw this.notFound();
    const decision = canTransitionTicket({
      actor,
      ticket,
      currentStatus: ticket.status,
      nextStatus,
      ...(resolution === undefined ? {} : { resolution }),
      ...(reason === undefined ? {} : { reason }),
    });
    if (!decision.allowed) throw this.conflict(`Ticket transition rejected: ${decision.reason}`);
    return this.unwrap(this.repository.transition(
      scope,
      ticketId,
      ticket.status,
      nextStatus,
      resolution,
      reason,
      expectedUpdatedAt,
      audit,
    ));
  }

  async confirmResolution(
    actor: ActorContext,
    ticketId: string,
    decisionName: "confirm" | "reject",
    reason: string | undefined,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    const readTicket = await this.repository.findAuthorized(this.scope(actor, "tickets.read"), ticketId);
    if (readTicket === null) throw this.notFound();
    const decision = canConfirmTicketResolution({
      currentStatus: readTicket.status,
      decision: decisionName,
      ...(reason === undefined ? {} : { reason }),
    });
    if (!decision.allowed) throw this.conflict(`Resolution decision rejected: ${decision.reason}`);
    const action = decisionName === "confirm"
      ? "tickets.confirm_resolution" as const
      : "tickets.reject_resolution" as const;
    const scope = this.authorization.assertAllowed({
      actor,
      action,
      resourceType: "ticket",
      resourceId: ticketId,
      resourceOwnerId: readTicket.requesterUserId,
      resourceState: readTicket.status,
      ...(readTicket.organizationId === null ? {} : { organizationId: readTicket.organizationId }),
    }).repositoryScope!;
    return this.unwrap(this.repository.confirmResolution(
      scope,
      ticketId,
      decisionName,
      reason,
      expectedUpdatedAt,
      audit,
    ));
  }

  async requestReopen(
    actor: ActorContext,
    ticketId: string,
    reason: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ) {
    const readTicket = await this.repository.findAuthorized(this.scope(actor, "tickets.read"), ticketId);
    if (readTicket === null) throw this.notFound();
    const scope = this.authorization.assertAllowed({
      actor,
      action: "tickets.request_reopen",
      resourceType: "ticket",
      resourceId: ticketId,
      resourceOwnerId: readTicket.requesterUserId,
      resourceState: readTicket.status,
      ...(readTicket.organizationId === null ? {} : { organizationId: readTicket.organizationId }),
    }).repositoryScope!;
    return this.unwrap(this.repository.transition(
      scope,
      ticketId,
      "closed",
      "reopened",
      undefined,
      reason,
      expectedUpdatedAt,
      audit,
    ));
  }

  async listComments(actor: ActorContext, ticketId: string) {
    const scope = this.scope(actor, "tickets.read");
    const internalDecision = this.authorization.can({
      actor,
      action: "ticket_comments.read_internal",
      resourceType: "ticket_comment",
    });
    const result = await this.repository.listComments(
      scope,
      ticketId,
      actor.internal && internalDecision.allowed,
    );
    if (result === null) throw this.notFound();
    return result;
  }

  createComment(
    actor: ActorContext,
    ticketId: string,
    content: string,
    requestedVisibility: TicketCommentVisibility | undefined,
    audit: AuditContext,
  ) {
    const internalDecision = this.authorization.can({
      actor,
      action: "ticket_comments.create_internal",
      resourceType: "ticket_comment",
    });
    const visibility: TicketCommentVisibility = requestedVisibility ??
      (internalDecision.allowed ? "internal" : "client");
    const action = visibility === "internal"
      ? "ticket_comments.create_internal" as const
      : "ticket_comments.create_client" as const;
    return this.unwrap(this.repository.createComment(
      this.scope(actor, action),
      ticketId,
      actor.localUserId,
      visibility,
      content,
      audit,
    ));
  }

  private scope(
    actor: ActorContext,
    action: TicketAction,
    requestedScope?: "own",
  ): AuthorizedRepositoryScope {
    return this.authorization.assertAllowed({
      actor,
      action,
      ...(requestedScope === undefined ? {} : { requestedScope }),
      resourceType: "ticket",
    }).repositoryScope!;
  }

  private async unwrap<T>(promise: Promise<TicketWriteResult<T>>): Promise<T> {
    const result = await promise;
    if (result === "not_found") throw this.notFound();
    if (result === "conflict") throw this.conflict("Resource state changed concurrently");
    if (result === "project_closed") throw this.conflict("The project no longer accepts tickets");
    if (result === "invalid_context") {
      throw new AppError({
        code: ErrorCode.NotFound,
        message: "Ticket context not found",
        statusCode: 404,
      });
    }
    if (result === "ineligible_user") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "The selected assignee is not an active internal local user",
        statusCode: 400,
      });
    }
    return result;
  }

  private notFound(): AppError {
    return new AppError({ code: ErrorCode.NotFound, message: "Ticket not found", statusCode: 404 });
  }

  private conflict(message: string): AppError {
    return new AppError({ code: ErrorCode.Conflict, message, statusCode: 409 });
  }
}
