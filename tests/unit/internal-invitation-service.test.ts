/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- Vitest repository and gateway mocks implement async interfaces. */
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import { InternalInvitationService } from "../../src/modules/internal-invitations/internal-invitation.service.js";
import type { InternalInvitation, InternalInvitationRepository } from "../../src/modules/internal-invitations/internal-invitation.types.js";
import type { ClerkInvitationGateway, VerifiedClerkUser } from "../../src/modules/client-invitations/client-invitation.types.js";
import { USER_A, actor } from "../helpers/actors.js";

const INVITATION_ID = "00000000-0000-4000-8000-000000000821";
const USER_B = "00000000-0000-4000-8000-000000000822";
const ROLE_ID = "00000000-0000-4000-8000-000000000823";
const now = new Date("2026-08-26T12:00:00.000Z");
const audit = { actorUserId: USER_A, requestId: "00000000-0000-4000-8000-000000000829" };
const role = { id: ROLE_ID, code: "contributor", name: "Colaborador", description: "Trabajo interno" };
const invitation: InternalInvitation = {
  id: INVITATION_ID, email: "person@example.test", roleCode: role.code, roleName: role.name,
  status: "pending", clerkInvitationId: null, invitedByUserId: USER_A, acceptedByUserId: null,
  expiresAt: new Date("2026-09-25T12:00:00.000Z"), acceptedAt: null, revokedAt: null,
  createdAt: now, updatedAt: now,
};

function clerkIdentity(clerkUserId = "user_new"): VerifiedClerkUser {
  return {
    clerkUserId,
    verifiedEmails: [invitation.email],
    primaryEmail: invitation.email,
    firstName: "Person",
    lastName: null,
    avatarUrl: null,
    syncedAt: now,
  };
}

function repository(): InternalInvitationRepository {
  return {
    listAssignableRoles: vi.fn(async () => [role]),
    findAssignableRole: vi.fn(async (_actorId, code) => code === role.code ? role : null),
    list: vi.fn(async () => [invitation]),
    reserve: vi.fn(async () => invitation),
    finalizeDelivery: vi.fn(async (_id, clerkInvitationId) => ({ ...invitation, clerkInvitationId })),
    cancelDelivery: vi.fn(async () => undefined),
    grantExisting: vi.fn(async () => ({ kind: "not_synchronized" as const })),
    beginResend: vi.fn(async () => ({ kind: "not_found" as const })),
    finalizeResend: vi.fn(async (_id, clerkInvitationId) => ({ ...invitation, clerkInvitationId })),
    revoke: vi.fn(async () => "not_found" as const),
    claim: vi.fn(async () => ({ kind: "not_found" as const })),
  };
}

function gateway(): ClerkInvitationGateway {
  return {
    findVerifiedUserByEmail: vi.fn(async () => null),
    getVerifiedUser: vi.fn(async (clerkUserId: string) => clerkIdentity(clerkUserId)),
    getVerifiedEmails: vi.fn(async () => ["person@example.test"]),
    createInvitation: vi.fn(async () => ({ id: "inv_internal" })),
    revokeInvitation: vi.fn(async () => undefined),
  };
}

function manager() {
  return actor({ internal: true, permissions: [{ code: "users.manage", scopes: ["global"] }] });
}

describe("internal invitation service", () => {
  it("lists only repository-calculated assignable roles", async () => {
    const repo = repository();
    const service = new InternalInvitationService(repo, new AuthorizationService(), gateway(), "http://127.0.0.1:5173");
    await expect(service.listRoles(manager())).resolves.toEqual([role]);
    expect(repo.listAssignableRoles).toHaveBeenCalledWith(USER_A);
  });

  it("reserves before Clerk and uses only the opaque internal correlation parameter", async () => {
    const repo = repository();
    const clerk = gateway();
    const calls: string[] = [];
    vi.mocked(repo.reserve).mockImplementation(async () => { calls.push("reserve"); return invitation; });
    vi.mocked(clerk.createInvitation).mockImplementation(async (input) => {
      calls.push("clerk");
      const redirect = new URL(input.redirectUrl);
      expect(redirect.searchParams.get("ilvox_internal_invitation")).toBe(INVITATION_ID);
      expect(redirect.searchParams.has("ilvox_invitation")).toBe(false);
      expect(redirect.searchParams.has("roleCode")).toBe(false);
      return { id: "inv_internal" };
    });
    const service = new InternalInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173", () => now);
    const result = await service.create(manager(), { email: " Person@Example.Test ", roleCode: role.code }, audit);
    expect(result.outcome).toBe("invitation_sent");
    expect(calls).toEqual(["reserve", "clerk"]);
    expect(repo.reserve).toHaveBeenCalledWith(expect.objectContaining({ normalizedEmail: "person@example.test", roleId: ROLE_ID }));
  });

  it("grants a synchronized existing Clerk account without creating another identity", async () => {
    const repo = repository();
    const clerk = gateway();
    vi.mocked(clerk.findVerifiedUserByEmail).mockResolvedValue(clerkIdentity("user_existing"));
    vi.mocked(repo.grantExisting).mockResolvedValue({ kind: "granted", invitation: { ...invitation, status: "accepted", acceptedByUserId: USER_B, acceptedAt: now } });
    const service = new InternalInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");
    await expect(service.create(manager(), { email: invitation.email, roleCode: role.code }, audit)).resolves.toMatchObject({ outcome: "existing_account_granted" });
    expect(clerk.createInvitation).not.toHaveBeenCalled();
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it("rejects clients, actors without users.manage, and every non-assignable role before Clerk mutation", async () => {
    const repo = repository();
    const clerk = gateway();
    const service = new InternalInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");
    await expect(service.create(actor({ internal: false, permissions: [{ code: "users.manage", scopes: ["global"] }] }), { email: invitation.email, roleCode: role.code }, audit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create(actor({ internal: true }), { email: invitation.email, roleCode: role.code }, audit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const roleCode of ["super_admin", "client_manager", "missing"]) {
      await expect(service.create(manager(), { email: invitation.email, roleCode }, audit)).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    }
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("maps delayed webhook, inactive profile and safe claim lifecycle states", async () => {
    const repo = repository();
    const service = new InternalInvitationService(repo, new AuthorizationService(), gateway(), "http://127.0.0.1:5173");
    vi.mocked(repo.claim).mockResolvedValue({ kind: "not_synchronized" });
    await expect(service.claim("user_new", INVITATION_ID, audit)).rejects.toMatchObject({ code: "PROFILE_NOT_SYNCHRONIZED", statusCode: 409, details: { retryable: true } });
    vi.mocked(repo.claim).mockResolvedValue({ kind: "already_claimed", invitation: { ...invitation, status: "accepted" } });
    await expect(service.claim("user_new", INVITATION_ID, audit)).resolves.toMatchObject({ alreadyClaimed: true, audience: "internal" });
    for (const [kind, code] of [["expired", "INVITATION_EXPIRED"], ["revoked", "INVITATION_REVOKED"], ["used", "INVITATION_USED"], ["email_mismatch", "INVITATION_EMAIL_MISMATCH"], ["ineligible_profile", "PROFILE_INACTIVE"]] as const) {
      vi.mocked(repo.claim).mockResolvedValue({ kind });
      await expect(service.claim("user_new", INVITATION_ID, audit)).rejects.toMatchObject({ code });
    }
  });

  it("replaces a pending invitation once and revokes its former Clerk link", async () => {
    const repo = repository();
    const clerk = gateway();
    vi.mocked(repo.beginResend).mockResolvedValue({ kind: "created", invitation, previousClerkInvitationId: "inv_old" });
    const service = new InternalInvitationService(repo, new AuthorizationService(), clerk, "http://127.0.0.1:5173");
    await service.resend(manager(), INVITATION_ID, audit);
    expect(clerk.revokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(repo.finalizeResend).toHaveBeenCalledWith(INVITATION_ID, "inv_internal", audit);
  });
});
