import type { ActorContext } from "../auth/authorization.types.js";

export const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "paused",
  "in_review",
  "delivered",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectTransitionTarget {
  readonly id: string;
  readonly status: ProjectStatus;
}

export interface ProjectTransitionDecision {
  readonly allowed: boolean;
  readonly reason:
    | "allowed"
    | "same_status"
    | "transition_not_allowed"
    | "reason_required"
    | "admin_required"
    | "milestones_incomplete"
    | "deliverables_unapproved";
}

const TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planning: ["in_progress", "cancelled"],
  in_progress: ["paused", "in_review", "cancelled"],
  paused: ["in_progress", "cancelled"],
  in_review: ["in_progress", "delivered", "cancelled"],
  delivered: ["in_progress"],
  cancelled: ["planning"],
};

function isAdministrator(actor: ActorContext): boolean {
  return actor.roles.some((role) =>
    role.scope === "global" && (role.code === "admin" || role.code === "super_admin"));
}

export function canTransitionProject(input: {
  readonly currentStatus: ProjectStatus;
  readonly nextStatus: ProjectStatus;
  readonly actor: ActorContext;
  readonly project: ProjectTransitionTarget;
  readonly reason?: string;
  readonly incompleteMilestones?: number;
  readonly unapprovedDeliverables?: number;
}): ProjectTransitionDecision {
  if (input.currentStatus === input.nextStatus) return { allowed: false, reason: "same_status" };
  if (!TRANSITIONS[input.currentStatus].includes(input.nextStatus)) {
    return { allowed: false, reason: "transition_not_allowed" };
  }
  if (
    (input.currentStatus === "delivered" || input.currentStatus === "cancelled") &&
    !isAdministrator(input.actor)
  ) {
    return { allowed: false, reason: "admin_required" };
  }
  if (
    (input.nextStatus === "cancelled" ||
      input.currentStatus === "delivered" ||
      input.currentStatus === "cancelled") &&
    input.reason?.trim() === ""
  ) {
    return { allowed: false, reason: "reason_required" };
  }
  if (
    (input.nextStatus === "cancelled" ||
      input.currentStatus === "delivered" ||
      input.currentStatus === "cancelled") &&
    input.reason === undefined
  ) {
    return { allowed: false, reason: "reason_required" };
  }
  if (input.nextStatus === "delivered" && (input.incompleteMilestones ?? 0) > 0) {
    return { allowed: false, reason: "milestones_incomplete" };
  }
  if (input.nextStatus === "delivered" && (input.unapprovedDeliverables ?? 0) > 0) {
    return { allowed: false, reason: "deliverables_unapproved" };
  }
  return { allowed: true, reason: "allowed" };
}
