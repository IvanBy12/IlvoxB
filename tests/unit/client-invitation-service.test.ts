/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- Vitest mocks intentionally expose callable interface members. */
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import { ClientInvitationService } from "../../src/modules/client-invitations/client-invitation.service.js";
import type {
  ClientInvitation,
  ClientInvitationRepository,
  ClerkInvitationGateway,
  VerifiedClerkUser,
} from "../../src/modules/client-invitations/client-invitation.types.js";
import { ORG_A, USER_A, actor } from "../helpers/actors.js";

const INVITATION_ID = "00000000-0000-4000-8000-000000000801";
const now = new Date("2026-08-04T12:00:00.000Z");
const invitation: ClientInvitation = {
  id: INVITATION_ID,
  organizationId: ORG_A,
  email: "client@example.test",
  membershipRole: "client_contact",
  status: "pending",
  clerkInvitationId: null,
  invitedByUserId: USER_A,
  invitedByEmail: "internal@example.test",
  invitedByName: "Internal User",
  acceptedByUserId: null,
  expiresAt: new Date("2026-09-03T12:00:00.000Z"),
  acceptedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
};

const audit = { actorUserId: USER_A, organizationId: ORG_A, requestId: "00000000-0000-4000-8000-000000000899" };

function clerkIdentity(clerkUserId = "user_new", email = "client@example.test"): VerifiedClerkUser {
  return {
    clerkUserId,
    verifiedEmails: [email],
    primaryEmail: email,
    firstName: "Client",
    lastName: "User",
    avatarUrl: null,
    syncedAt: now,
  };
}

function repository(): ClientInvitationRepository {
  return {
    actorOwnsEmail: vi.fn(async () => false),
    listAuthorized: vi.fn(async () => []),
    reserve: vi.fn(async () => invitation),
    finalizeDelivery: vi.fn(async (_id, clerkInvitationId) => ({ ...invitation, clerkInvitationId })),
    cancelDelivery: vi.fn(async () => undefined),
    grantExisting: vi.fn(async () => ({ kind: "organization_not_found" as const })),
    beginResend: vi.fn(async () => ({ kind: "invitation_not_found" as const })),
    finalizeResend: vi.fn(async (_id, clerkInvitationId) => ({ ...invitation, clerkInvitationId })),
    revokeAuthorized: vi.fn(async () => "invitation_not_found" as const),
    claim: vi.fn(async () => ({ kind: "not_found" as const })),
  };
}

function gateway(): ClerkInvitationGateway {
  return {
    findVerifiedUserByEmail: vi.fn(async () => null),
    getVerifiedUser: vi.fn(async (clerkUserId: string) => clerkIdentity(clerkUserId)),
    getVerifiedEmails: vi.fn(async () => ["client@example.test"]),
    createInvitation: vi.fn(async () => ({ id: "inv_clerk" })),
    revokeInvitation: vi.fn(async () => undefined),
  };
}

function internalActor() {
  return actor({
    internal: true,
    permissions: [{
      code: "organization_members.manage",
      scopes: ["organization"],
      scopeOrganizationIds: { organization: [ORG_A] },
    }],
  });
}

describe("client invitation service", () => {
  it("reserves locally before issuing the official Clerk invitation and only correlates by opaque id", async () => {
    const calls: string[] = [];
    const repo = repository();
    const clerk = gateway();
    vi.mocked(repo.reserve).mockImplementation(async () => { calls.push("reserve"); return invitation; });
    vi.mocked(clerk.createInvitation).mockImplementation(async (input) => {
      calls.push("clerk");
      const redirect = new URL(input.redirectUrl);
      expect(redirect.pathname).toBe("/invitacion/aceptar");
      expect(redirect.searchParams.get("ilvox_invitation")).toBe(INVITATION_ID);
      expect(redirect.searchParams.has("organizationId")).toBe(false);
      expect(redirect.searchParams.has("role")).toBe(false);
      return { id: "inv_clerk" };
    });
    const service = new ClientInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173", () => now);

    const result = await service.create(internalActor(), ORG_A, {
      email: " Client@Example.Test ",
      membershipRole: "client_contact",
    }, audit);

    expect(calls).toEqual(["reserve", "clerk"]);
    expect(result.outcome).toBe("invitation_sent");
    expect(repo.reserve).toHaveBeenCalledWith(expect.objectContaining({ kind: "organization" }), expect.objectContaining({
      normalizedEmail: "client@example.test",
      membershipRole: "client_contact",
    }));
  });

  it("grants an existing verified Clerk identity without creating a duplicate identity or invitation", async () => {
    const repo = repository();
    const clerk = gateway();
    vi.mocked(clerk.findVerifiedUserByEmail).mockResolvedValue(clerkIdentity("user_existing"));
    vi.mocked(repo.grantExisting).mockResolvedValue({
      kind: "granted",
      invitation: { ...invitation, status: "accepted", acceptedByUserId: "00000000-0000-4000-8000-000000000802", acceptedAt: now },
    });
    const service = new ClientInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173", () => now);

    const result = await service.create(internalActor(), ORG_A, {
      email: "client@example.test",
      membershipRole: "client_manager",
    }, audit);

    expect(result.outcome).toBe("existing_account_granted");
    expect(repo.grantExisting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      identity: expect.objectContaining({ clerkUserId: "user_existing" }),
      membershipRole: "client_manager",
    }), audit);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("rejects client actors and self-invitations before Clerk mutation", async () => {
    const repo = repository();
    const clerk = gateway();
    const service = new ClientInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");
    const client = actor({
      internal: false,
      permissions: [{ code: "organization_members.manage", scopes: ["organization"] }],
    });
    await expect(service.create(client, ORG_A, { email: "client@example.test", membershipRole: "client_contact" }, audit))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(repo.actorOwnsEmail).mockResolvedValue(true);
    await expect(service.create(internalActor(), ORG_A, { email: "internal@example.test", membershipRole: "client_contact" }, audit))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("passes the authenticated Clerk profile to the transactional claim reconciliation", async () => {
    const repo = repository();
    const clerk = gateway();
    vi.mocked(repo.claim).mockResolvedValue({
      kind: "claimed",
      invitation: { ...invitation, status: "accepted" },
      profileExisted: false,
      reconciliationAttempted: true,
      membershipCreated: true,
    });
    const service = new ClientInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");

    await expect(service.claim("user_new", INVITATION_ID, audit)).resolves.toMatchObject({
      reconciliationAttempted: true,
      membershipCreated: true,
    });
    expect(repo.claim).toHaveBeenCalledWith(
      INVITATION_ID,
      expect.objectContaining({ clerkUserId: "user_new", verifiedEmails: ["client@example.test"] }),
      audit,
    );
  });

  it("keeps claim idempotent and maps expired, revoked, used and mismatched-email states safely", async () => {
    const repo = repository();
    const clerk = gateway();
    const service = new ClientInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");
    vi.mocked(repo.claim).mockResolvedValue({
      kind: "already_claimed",
      invitation: { ...invitation, status: "accepted" },
      profileExisted: true,
      reconciliationAttempted: false,
      membershipCreated: false,
    });
    await expect(service.claim("user_new", INVITATION_ID, audit)).resolves.toMatchObject({ alreadyClaimed: true });

    for (const [kind, code] of [
      ["expired", "INVITATION_EXPIRED"],
      ["revoked", "INVITATION_REVOKED"],
      ["used", "INVITATION_USED"],
      ["email_mismatch", "INVITATION_EMAIL_MISMATCH"],
    ] as const) {
      vi.mocked(repo.claim).mockResolvedValue({ kind });
      await expect(service.claim("user_new", INVITATION_ID, audit)).rejects.toMatchObject({ code });
    }
  });

  it("replaces pending invitations once, revokes the former Clerk invitation, and returns the replacement idempotently", async () => {
    const repo = repository();
    const clerk = gateway();
    vi.mocked(repo.beginResend).mockResolvedValue({
      kind: "created",
      invitation,
      previousClerkInvitationId: "inv_old",
    });
    const service = new ClientInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");
    await service.resend(internalActor(), ORG_A, INVITATION_ID, audit);
    expect(clerk.revokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(repo.finalizeResend).toHaveBeenCalledWith(INVITATION_ID, "inv_clerk", audit);

    vi.mocked(repo.beginResend).mockResolvedValue({ kind: "already_replaced", invitation });
    await service.resend(internalActor(), ORG_A, INVITATION_ID, audit);
    expect(clerk.createInvitation).toHaveBeenCalledTimes(1);
  });
});
