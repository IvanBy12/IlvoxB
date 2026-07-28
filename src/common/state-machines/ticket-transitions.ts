import type { ActorContext } from "../auth/authorization.types.js";

export const TICKET_STATUSES = [
  "new",
  "classifying",
  "assigned",
  "in_progress",
  "pending_client",
  "resolved",
  "closed",
  "reopened",
  "cancelled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TicketTransitionSubject {
  readonly requesterUserId: string;
  readonly assignedToUserId: string | null;
  readonly status: TicketStatus;
}

export interface TicketTransitionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const NORMAL_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: ["classifying", "cancelled"],
  classifying: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["pending_client", "resolved", "cancelled"],
  pending_client: ["in_progress", "cancelled"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["assigned", "in_progress", "cancelled"],
  cancelled: ["reopened"],
};

function isAdministrator(actor: ActorContext): boolean {
  return actor.roles.some((role) =>
    role.scope === "global" && ["super_admin", "admin"].includes(role.code));
}

export function canTransitionTicket(input: {
  readonly currentStatus: TicketStatus;
  readonly nextStatus: TicketStatus;
  readonly actor: ActorContext;
  readonly ticket: TicketTransitionSubject;
  readonly reason?: string;
  readonly resolution?: string;
}): TicketTransitionDecision {
  if (!NORMAL_TRANSITIONS[input.currentStatus].includes(input.nextStatus)) {
    return { allowed: false, reason: "transition_not_allowed" };
  }
  if (input.nextStatus === "assigned" && input.ticket.assignedToUserId === null) {
    return { allowed: false, reason: "assignee_required" };
  }
  if (input.nextStatus === "resolved" && (input.resolution?.trim() ?? "") === "") {
    return { allowed: false, reason: "resolution_required" };
  }
  if (["cancelled", "reopened"].includes(input.nextStatus) &&
      (input.reason?.trim() ?? "") === "") {
    return { allowed: false, reason: "reason_required" };
  }
  if (input.currentStatus === "cancelled" && input.nextStatus === "reopened" &&
      !isAdministrator(input.actor)) {
    return { allowed: false, reason: "administrator_required" };
  }
  if (input.currentStatus === "closed" && input.nextStatus === "reopened" &&
      !isAdministrator(input.actor)) {
    return { allowed: false, reason: "administrator_required" };
  }
  return { allowed: true, reason: "allowed" };
}

export function canConfirmTicketResolution(input: {
  readonly currentStatus: TicketStatus;
  readonly decision: "confirm" | "reject";
  readonly reason?: string;
}): TicketTransitionDecision {
  if (input.currentStatus !== "resolved") {
    return { allowed: false, reason: "ticket_not_resolved" };
  }
  if (input.decision === "reject" && (input.reason?.trim() ?? "") === "") {
    return { allowed: false, reason: "reason_required" };
  }
  return { allowed: true, reason: "allowed" };
}
