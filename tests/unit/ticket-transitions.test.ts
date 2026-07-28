import { describe, expect, it } from "vitest";
import {
  canConfirmTicketResolution,
  canTransitionTicket,
} from "../../src/common/state-machines/ticket-transitions.js";
import { actor, USER_A, USER_B } from "../helpers/actors.js";

const ticket = {
  requesterUserId: USER_A,
  assignedToUserId: USER_B,
  status: "in_progress" as const,
};

describe("ticket state machine", () => {
  it("accepts the normal flow and enforces assignment and resolution", () => {
    expect(canTransitionTicket({
      actor: actor({ internal: true }),
      ticket,
      currentStatus: "in_progress",
      nextStatus: "resolved",
      resolution: "Corrected",
    }).allowed).toBe(true);
    expect(canTransitionTicket({
      actor: actor({ internal: true }),
      ticket: { ...ticket, assignedToUserId: null, status: "classifying" },
      currentStatus: "classifying",
      nextStatus: "assigned",
    }).reason).toBe("assignee_required");
    expect(canTransitionTicket({
      actor: actor({ internal: true }),
      ticket,
      currentStatus: "in_progress",
      nextStatus: "resolved",
    }).reason).toBe("resolution_required");
  });

  it("requires reasons and administrator authority for exceptional reopen", () => {
    expect(canTransitionTicket({
      actor: actor({ internal: true, roleCode: "support_agent" }),
      ticket: { ...ticket, status: "closed" },
      currentStatus: "closed",
      nextStatus: "reopened",
      reason: "Regression",
    }).reason).toBe("administrator_required");
    expect(canTransitionTicket({
      actor: actor({ internal: true, roleCode: "admin" }),
      ticket: { ...ticket, status: "closed" },
      currentStatus: "closed",
      nextStatus: "reopened",
      reason: "Regression",
    }).allowed).toBe(true);
  });

  it("maps requester confirmation and rejection without arbitrary target status", () => {
    expect(canConfirmTicketResolution({
      currentStatus: "resolved",
      decision: "confirm",
    }).allowed).toBe(true);
    expect(canConfirmTicketResolution({
      currentStatus: "resolved",
      decision: "reject",
    }).reason).toBe("reason_required");
    expect(canConfirmTicketResolution({
      currentStatus: "closed",
      decision: "confirm",
    }).reason).toBe("ticket_not_resolved");
  });
});
