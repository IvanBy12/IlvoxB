import { describe, expect, it } from "vitest";
import { canTransitionProject } from "../../src/common/state-machines/project-transitions.js";
import { actor } from "../helpers/actors.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000701";

describe("project transitions", () => {
  it("accepts the controlled delivery path", () => {
    const decision = canTransitionProject({
      actor: actor({ internal: true, roleCode: "project_lead" }),
      project: { id: PROJECT_ID, status: "in_review" },
      currentStatus: "in_review",
      nextStatus: "delivered",
      incompleteMilestones: 0,
      unapprovedDeliverables: 0,
    });
    expect(decision).toEqual({ allowed: true, reason: "allowed" });
  });

  it("blocks invalid jumps and incomplete delivery", () => {
    expect(canTransitionProject({
      actor: actor({ internal: true, roleCode: "project_lead" }),
      project: { id: PROJECT_ID, status: "planning" },
      currentStatus: "planning",
      nextStatus: "delivered",
    }).reason).toBe("transition_not_allowed");
    expect(canTransitionProject({
      actor: actor({ internal: true, roleCode: "project_lead" }),
      project: { id: PROJECT_ID, status: "in_review" },
      currentStatus: "in_review",
      nextStatus: "delivered",
      incompleteMilestones: 1,
    }).reason).toBe("milestones_incomplete");
  });

  it("requires an administrator and reason to reopen a terminal project", () => {
    expect(canTransitionProject({
      actor: actor({ internal: true, roleCode: "project_lead" }),
      project: { id: PROJECT_ID, status: "delivered" },
      currentStatus: "delivered",
      nextStatus: "in_progress",
      reason: "Correction",
    }).reason).toBe("admin_required");
    expect(canTransitionProject({
      actor: actor({ internal: true, roleCode: "admin" }),
      project: { id: PROJECT_ID, status: "delivered" },
      currentStatus: "delivered",
      nextStatus: "in_progress",
    }).reason).toBe("reason_required");
  });
});
