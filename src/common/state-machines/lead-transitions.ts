import type { ActorContext } from "../auth/authorization.types.js";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "in_diagnostic",
  "quotation",
  "proposal_sent",
  "negotiation",
  "approved",
  "not_approved",
  "converted",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

const TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ["contacted", "not_approved"],
  contacted: ["in_diagnostic", "not_approved"],
  in_diagnostic: ["quotation", "not_approved"],
  quotation: ["proposal_sent", "not_approved"],
  proposal_sent: ["negotiation", "not_approved"],
  negotiation: ["approved", "not_approved"],
  approved: [],
  not_approved: ["contacted"],
  converted: [],
};

export interface LeadTransitionSubject {
  readonly id: string;
  readonly status: LeadStatus;
  readonly assignedToUserId: string | null;
}

export interface LeadTransitionRequest {
  readonly currentStatus: LeadStatus;
  readonly nextStatus: LeadStatus;
  readonly actor: ActorContext;
  readonly lead: LeadTransitionSubject;
  readonly reason?: string;
}

export interface LeadTransitionDecision {
  readonly allowed: boolean;
  readonly reasonCode:
    | "ALLOW"
    | "ACTOR_NOT_INTERNAL"
    | "INVALID_TRANSITION"
    | "REASON_REQUIRED"
    | "CONVERSION_ENDPOINT_REQUIRED";
}

export function canTransitionLead(request: LeadTransitionRequest): LeadTransitionDecision {
  if (!request.actor.internal) return { allowed: false, reasonCode: "ACTOR_NOT_INTERNAL" };
  if (request.nextStatus === "converted") {
    return { allowed: false, reasonCode: "CONVERSION_ENDPOINT_REQUIRED" };
  }
  if (!TRANSITIONS[request.currentStatus].includes(request.nextStatus)) {
    return { allowed: false, reasonCode: "INVALID_TRANSITION" };
  }
  const requiresReason =
    request.nextStatus === "not_approved" || request.currentStatus === "not_approved";
  if (requiresReason && (request.reason === undefined || request.reason.trim().length === 0)) {
    return { allowed: false, reasonCode: "REASON_REQUIRED" };
  }
  return { allowed: true, reasonCode: "ALLOW" };
}

export function allowedLeadTransitions(status: LeadStatus): readonly LeadStatus[] {
  return TRANSITIONS[status];
}
