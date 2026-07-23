import { describe, expect, it } from "vitest";
import {
  LEAD_STATUSES,
  allowedLeadTransitions,
  canTransitionLead,
  type LeadStatus,
} from "../../src/common/state-machines/lead-transitions.js";
import { USER_A, actor } from "../helpers/actors.js";

const internalActor = actor({ internal: true });

function decision(currentStatus: LeadStatus, nextStatus: LeadStatus, reason?: string) {
  return canTransitionLead({
    currentStatus,
    nextStatus,
    actor: internalActor,
    lead: {
      id: "00000000-0000-4000-8000-000000000501",
      status: currentStatus,
      assignedToUserId: USER_A,
    },
    ...(reason === undefined ? {} : { reason }),
  });
}

describe("lead state machine", () => {
  it("uses exactly the PostgreSQL status catalog", () => {
    expect(LEAD_STATUSES).toEqual([
      "new",
      "contacted",
      "in_diagnostic",
      "quotation",
      "proposal_sent",
      "negotiation",
      "approved",
      "not_approved",
      "converted",
    ]);
  });

  it("accepts the forward pipeline and controlled reopen", () => {
    expect(decision("new", "contacted").allowed).toBe(true);
    expect(decision("negotiation", "approved").allowed).toBe(true);
    expect(decision("not_approved", "contacted", "Client requested a new review").allowed).toBe(true);
  });

  it("requires a reason for rejection and reopening", () => {
    expect(decision("new", "not_approved").reasonCode).toBe("REASON_REQUIRED");
    expect(decision("not_approved", "contacted").reasonCode).toBe("REASON_REQUIRED");
  });

  it("reserves converted for the transactional conversion endpoint", () => {
    expect(decision("approved", "converted").reasonCode).toBe("CONVERSION_ENDPOINT_REQUIRED");
    expect(allowedLeadTransitions("converted")).toEqual([]);
  });

  it("rejects skipped transitions and non-internal actors", () => {
    expect(decision("new", "negotiation").reasonCode).toBe("INVALID_TRANSITION");
    const external = actor({ internal: false });
    expect(canTransitionLead({
      currentStatus: "new",
      nextStatus: "contacted",
      actor: external,
      lead: { id: "lead", status: "new", assignedToUserId: null },
    }).reasonCode).toBe("ACTOR_NOT_INTERNAL");
  });
});
