import type { Pool } from "pg";
import { AppError } from "../errors/app-error.js";
import { ErrorCode } from "../errors/error-codes.js";
import type { AuthorizationService } from "./authorization.service.js";
import type { ActorContext } from "./authorization.types.js";

export type TicketClientAction =
  | "tickets.confirm_resolution"
  | "tickets.reject_resolution"
  | "tickets.request_reopen";

export interface TicketClientActionRequest {
  readonly actor: ActorContext;
  readonly action: TicketClientAction;
  readonly ticketId: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly reason?: string;
  readonly requestedTargetState?: string;
}

interface TicketRow { readonly status: string; readonly requester_user_id: string; }

export class TicketClientActionService {
  constructor(private readonly pool: Pool, private readonly authorization: AuthorizationService) {}

  async execute(request: TicketClientActionRequest): Promise<"applied" | "duplicate"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [request.requestId]);
      const prior = await client.query(
        "SELECT 1 FROM audit_events WHERE request_id=$1 AND actor_user_id=$2 AND action=$3 AND entity_id=$4",
        [request.requestId, request.actor.localUserId, request.action, request.ticketId],
      );
      if ((prior.rowCount ?? 0) > 0) {
        await client.query("COMMIT");
        return "duplicate";
      }
      const ticket = await client.query<TicketRow>(
        `SELECT status,requester_user_id FROM tickets
         WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [request.ticketId, request.organizationId],
      );
      const row = ticket.rows[0];
      if (row === undefined) {
        throw new AppError({ code: ErrorCode.NotFound, message: "Resource not found", statusCode: 404 });
      }
      this.validateIntent(request);
      this.authorization.assertAllowed({
        actor: request.actor, action: request.action, organizationId: request.organizationId,
        resourceType: "ticket", resourceId: request.ticketId, resourceOwnerId: row.requester_user_id,
        resourceState: row.status,
      });

      const nextState = request.action === "tickets.confirm_resolution" ? "closed" : "reopened";
      const update = request.action === "tickets.confirm_resolution"
        ? "UPDATE tickets SET status='closed',closed_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='resolved'"
        : "UPDATE tickets SET status='reopened',closed_at=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2 AND status=$3";
      const values = request.action === "tickets.confirm_resolution"
        ? [request.ticketId, request.organizationId]
        : [request.ticketId, request.organizationId, row.status];
      const updated = await client.query(update, values);
      if ((updated.rowCount ?? 0) !== 1) {
        throw new AppError({ code: ErrorCode.Conflict, message: "Ticket state changed", statusCode: 409 });
      }
      await client.query(
        `INSERT INTO audit_events
           (actor_user_id,organization_id,action,entity_type,entity_id,old_values,new_values,request_id)
         VALUES ($1,$2,$3,'ticket',$4,$5::jsonb,$6::jsonb,$7)`,
        [request.actor.localUserId, request.organizationId, request.action, request.ticketId,
          JSON.stringify({ status: row.status }), JSON.stringify({ status: nextState, reason: request.reason ?? null }),
          request.requestId],
      );
      await client.query("COMMIT");
      return "applied";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private validateIntent(request: TicketClientActionRequest): void {
    const requiredTarget = request.action === "tickets.confirm_resolution" ? "closed" :
      request.action === "tickets.reject_resolution" ? "reopened" : undefined;
    if (request.requestedTargetState !== undefined && request.requestedTargetState !== requiredTarget) {
      throw new AppError({ code: ErrorCode.ValidationError, message: "Invalid target state", statusCode: 422 });
    }
    if (request.action !== "tickets.confirm_resolution" && (request.reason?.trim() ?? "") === "") {
      throw new AppError({ code: ErrorCode.ValidationError, message: "A reason is required", statusCode: 422 });
    }
  }
}
