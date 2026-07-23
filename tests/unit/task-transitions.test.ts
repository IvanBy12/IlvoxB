import { describe, expect, it } from "vitest";
import { canTransitionTask } from "../../src/common/state-machines/task-transitions.js";
import { USER_A, USER_B, actor } from "../helpers/actors.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000701";

describe("task transitions", () => {
  it("allows an assignee to follow the ordinary workflow", () => {
    const task = { id: "task", projectId: null, assignedToUserId: USER_A, status: "pending" as const };
    expect(canTransitionTask({
      actor: actor({ internal: true, organizations: [] }),
      task,
      currentStatus: "pending",
      nextStatus: "ready",
    })).toEqual({ allowed: true, reason: "allowed" });
  });

  it("prevents arbitrary jumps and non-assignee transitions", () => {
    const task = {
      id: "task",
      projectId: PROJECT_ID,
      assignedToUserId: USER_B,
      status: "pending" as const,
    };
    expect(canTransitionTask({
      actor: actor({ internal: true, roleCode: "contributor" }),
      task,
      currentStatus: "pending",
      nextStatus: "completed",
    }).reason).toBe("transition_not_allowed");
    expect(canTransitionTask({
      actor: actor({ internal: true, roleCode: "contributor" }),
      task,
      currentStatus: "pending",
      nextStatus: "ready",
    }).reason).toBe("actor_not_eligible");
  });

  it("requires leader/admin privilege and a reason for terminal exits", () => {
    const task = {
      id: "task",
      projectId: PROJECT_ID,
      assignedToUserId: USER_A,
      status: "completed" as const,
    };
    expect(canTransitionTask({
      actor: actor({ internal: true, roleCode: "contributor" }),
      task,
      currentStatus: "completed",
      nextStatus: "in_progress",
      reason: "Correction",
    }).reason).toBe("leader_required");
    expect(canTransitionTask({
      actor: actor({ internal: true, roleCode: "admin" }),
      task,
      currentStatus: "completed",
      nextStatus: "in_progress",
    }).reason).toBe("reason_required");
  });
});
