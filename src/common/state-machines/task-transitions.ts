import type { ActorContext } from "../auth/authorization.types.js";

export const TASK_STATUSES = [
  "pending",
  "ready",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskTransitionTarget {
  readonly id: string;
  readonly projectId: string | null;
  readonly assignedToUserId: string;
  readonly status: TaskStatus;
}

export interface TaskTransitionDecision {
  readonly allowed: boolean;
  readonly reason:
    | "allowed"
    | "same_status"
    | "transition_not_allowed"
    | "actor_not_eligible"
    | "leader_required"
    | "admin_required"
    | "reason_required";
}

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: ["blocked", "in_review", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  in_review: ["in_progress", "completed", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["pending"],
};

function roleFlags(actor: ActorContext, projectId: string | null): {
  readonly leader: boolean;
  readonly administrator: boolean;
} {
  const administrator = actor.roles.some((role) =>
    role.scope === "global" && (role.code === "admin" || role.code === "super_admin"));
  const leader = administrator || actor.roles.some((role) =>
    (role.scope === "global" && role.code === "project_lead") ||
    (role.scope === "project" && role.code === "project_lead" && role.projectId === projectId));
  return { leader, administrator };
}

export function canTransitionTask(input: {
  readonly currentStatus: TaskStatus;
  readonly nextStatus: TaskStatus;
  readonly actor: ActorContext;
  readonly task: TaskTransitionTarget;
  readonly reason?: string;
}): TaskTransitionDecision {
  if (input.currentStatus === input.nextStatus) return { allowed: false, reason: "same_status" };
  if (!TRANSITIONS[input.currentStatus].includes(input.nextStatus)) {
    return { allowed: false, reason: "transition_not_allowed" };
  }
  const { leader, administrator } = roleFlags(input.actor, input.task.projectId);
  const assignee = input.task.assignedToUserId === input.actor.localUserId;
  if (input.currentStatus === "cancelled" && !administrator) {
    return { allowed: false, reason: "admin_required" };
  }
  if (
    (input.nextStatus === "completed" ||
      input.nextStatus === "cancelled" ||
      input.currentStatus === "completed") &&
    !leader
  ) {
    return { allowed: false, reason: "leader_required" };
  }
  if (!assignee && !leader) return { allowed: false, reason: "actor_not_eligible" };
  if (
    (input.nextStatus === "cancelled" ||
      input.currentStatus === "completed" ||
      input.currentStatus === "cancelled") &&
    input.reason?.trim() === ""
  ) {
    return { allowed: false, reason: "reason_required" };
  }
  if (
    (input.nextStatus === "cancelled" ||
      input.currentStatus === "completed" ||
      input.currentStatus === "cancelled") &&
    input.reason === undefined
  ) {
    return { allowed: false, reason: "reason_required" };
  }
  return { allowed: true, reason: "allowed" };
}
