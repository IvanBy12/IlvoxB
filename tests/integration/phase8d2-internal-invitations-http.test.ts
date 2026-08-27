/* eslint-disable @typescript-eslint/no-unsafe-member-access -- focused Fastify JSON assertions. */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import type { ClerkInvitationGateway, VerifiedClerkUser } from "../../src/modules/client-invitations/client-invitation.types.js";
import type { InternalInvitation, InternalInvitationRepository } from "../../src/modules/internal-invitations/internal-invitation.types.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { USER_A, actor } from "../helpers/actors.js";

const INVITATION_ID = "00000000-0000-4000-8000-000000000831";
const ROLE_ID = "00000000-0000-4000-8000-000000000832";
const now = new Date("2026-08-26T12:00:00.000Z");
const role = { id: ROLE_ID, code: "contributor", name: "Colaborador", description: null };
const invitation: InternalInvitation = {
  id: INVITATION_ID, email: "person@example.test", roleCode: role.code, roleName: role.name,
  status: "pending", clerkInvitationId: "inv_sensitive", invitedByUserId: USER_A, acceptedByUserId: null,
  expiresAt: new Date("2026-09-25T12:00:00.000Z"), acceptedAt: null, revokedAt: null,
  createdAt: now, updatedAt: now,
};
const clerkIdentity = (clerkUserId: string): VerifiedClerkUser => ({
  clerkUserId,
  verifiedEmails: [invitation.email],
  primaryEmail: invitation.email,
  firstName: "Person",
  lastName: null,
  avatarUrl: null,
  syncedAt: now,
});
const authenticated: AuthenticationProvider = { authenticate: () => Promise.resolve({ clerkUserId: "clerk_actor" }) };

function identity(internal = true, withPermission = true): IdentityRepository {
  return { findByClerkUserId: () => Promise.resolve({
    actor: { ...actor({ internal, permissions: withPermission ? [{ code: "users.manage", scopes: ["global"] }] : [] }), clerkUserId: "clerk_actor" },
    primaryEmail: "owner@example.test", firstName: "Owner", lastName: null, avatarUrl: null,
  }) };
}

function repository(): InternalInvitationRepository {
  return {
    listAssignableRoles: vi.fn(() => Promise.resolve([role])),
    findAssignableRole: vi.fn((_actorId, code) => Promise.resolve(code === role.code ? role : null)),
    list: vi.fn(() => Promise.resolve([invitation])),
    reserve: vi.fn(() => Promise.resolve(invitation)),
    finalizeDelivery: vi.fn<InternalInvitationRepository["finalizeDelivery"]>((_id, clerkId) => Promise.resolve({ ...invitation, clerkInvitationId: clerkId })),
    cancelDelivery: vi.fn(() => Promise.resolve()),
    grantExisting: vi.fn<InternalInvitationRepository["grantExisting"]>(() => Promise.resolve({ kind: "not_synchronized" })),
    beginResend: vi.fn<InternalInvitationRepository["beginResend"]>(() => Promise.resolve({ kind: "already_replaced", invitation })),
    finalizeResend: vi.fn<InternalInvitationRepository["finalizeResend"]>((_id, clerkId) => Promise.resolve({ ...invitation, clerkInvitationId: clerkId })),
    revoke: vi.fn<InternalInvitationRepository["revoke"]>(() => Promise.resolve({ ...invitation, status: "revoked", revokedAt: now })),
    claim: vi.fn<InternalInvitationRepository["claim"]>(() => Promise.resolve({ kind: "claimed", invitation: { ...invitation, status: "accepted", acceptedByUserId: USER_A, acceptedAt: now } })),
  };
}

function gateway(): ClerkInvitationGateway {
  return {
    findVerifiedUserByEmail: vi.fn(() => Promise.resolve(null)),
    getVerifiedUser: vi.fn((clerkUserId: string) => Promise.resolve(clerkIdentity(clerkUserId))),
    getVerifiedEmails: vi.fn(() => Promise.resolve([invitation.email])),
    createInvitation: vi.fn(() => Promise.resolve({ id: "inv_new" })),
    revokeInvitation: vi.fn(() => Promise.resolve()),
  };
}

describe("Phase 8D.2 internal invitations HTTP", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app !== undefined) await app.close(); app = undefined; });

  it("lists assignable roles and internal invitations without Clerk identifiers", async () => {
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), internalInvitationRepository: repository(), internalClerkInvitationGateway: gateway() });
    const roles = await app.inject({ method: "GET", url: "/api/v1/internal-roles" });
    expect(roles.statusCode).toBe(200);
    expect(roles.json().data).toEqual([{ code: "contributor", name: "Colaborador", description: null }]);
    const invitations = await app.inject({ method: "GET", url: "/api/v1/internal-invitations" });
    expect(invitations.statusCode).toBe(200);
    expect(invitations.json().data[0]).toMatchObject({ id: INVITATION_ID, email: invitation.email, roleCode: "contributor" });
    expect(JSON.stringify(invitations.json())).not.toContain("clerkInvitationId");
    expect(JSON.stringify(invitations.json())).not.toContain("inv_sensitive");
  });

  it("creates only the strict email+role payload and rejects client, privileged, client-role and extra fields", async () => {
    const repo = repository();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), internalInvitationRepository: repo, internalClerkInvitationGateway: gateway() });
    expect((await app.inject({ method: "POST", url: "/api/v1/internal-invitations", payload: { email: invitation.email, roleCode: role.code } })).statusCode).toBe(201);
    for (const extra of [{ permissions: ["users.manage"] }, { isInternal: true }, { status: "accepted" }, { organizationId: USER_A }]) {
      expect((await app.inject({ method: "POST", url: "/api/v1/internal-invitations", payload: { email: invitation.email, roleCode: role.code, ...extra } })).statusCode).toBe(400);
    }
    for (const roleCode of ["super_admin", "client_manager", "client_contact", "missing"]) {
      expect((await app.inject({ method: "POST", url: "/api/v1/internal-invitations", payload: { email: invitation.email, roleCode } })).statusCode).toBe(400);
    }
    await app.close();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(false), internalInvitationRepository: repository(), internalClerkInvitationGateway: gateway() });
    expect((await app.inject({ method: "POST", url: "/api/v1/internal-invitations", payload: { email: invitation.email, roleCode: role.code } })).statusCode).toBe(403);
    await app.close();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(true, false), internalInvitationRepository: repository(), internalClerkInvitationGateway: gateway() });
    expect((await app.inject({ method: "POST", url: "/api/v1/internal-invitations", payload: { email: invitation.email, roleCode: role.code } })).statusCode).toBe(403);
  });

  it("claims only an opaque UUID from the authenticated Clerk session and returns internal audience", async () => {
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), internalInvitationRepository: repository(), internalClerkInvitationGateway: gateway() });
    const response = await app.inject({ method: "POST", url: "/api/v1/internal-invitations/claim", payload: { invitationId: INVITATION_ID } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ alreadyClaimed: false, audience: "internal" });
    expect((await app.inject({ method: "POST", url: "/api/v1/internal-invitations/claim", payload: { invitationId: INVITATION_ID, roleCode: "admin" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/client-invitations/claim", payload: { invitationId: INVITATION_ID } })).statusCode).toBe(404);
  });

  it("rate-limits abusive resend attempts", async () => {
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), internalInvitationRepository: repository(), internalClerkInvitationGateway: gateway() });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject({ method: "POST", url: `/api/v1/internal-invitations/${INVITATION_ID}/resend` })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "POST", url: `/api/v1/internal-invitations/${INVITATION_ID}/resend` })).statusCode).toBe(429);
  });
});
