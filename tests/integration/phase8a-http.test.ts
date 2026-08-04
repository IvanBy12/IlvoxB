/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- HTTP contract tests use typed Vitest repository mocks. */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import type {
  ClientInvitation,
  ClientInvitationRepository,
  ClerkInvitationGateway,
} from "../../src/modules/client-invitations/client-invitation.types.js";
import { ORG_A, ORG_B, USER_A, actor } from "../helpers/actors.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const INVITATION_ID = "00000000-0000-4000-8000-000000000801";
const now = new Date("2026-08-04T12:00:00.000Z");
const invitation: ClientInvitation = {
  id: INVITATION_ID,
  organizationId: ORG_A,
  email: "client@example.test",
  membershipRole: "client_contact",
  status: "pending",
  clerkInvitationId: "inv_clerk",
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

const authenticated: AuthenticationProvider = {
  authenticate: () => Promise.resolve({ clerkUserId: "clerk_internal" }),
};
const unauthenticated: AuthenticationProvider = { authenticate: () => Promise.resolve(null) };

function identity(internal = true): IdentityRepository {
  return {
    findByClerkUserId: () => Promise.resolve({
      actor: {
        ...actor({
          internal,
          permissions: [{
            code: "organization_members.manage",
            scopes: ["organization"],
            scopeOrganizationIds: { organization: [ORG_A] },
          }],
        }),
        clerkUserId: "clerk_internal",
      },
      primaryEmail: "internal@example.test",
      firstName: "Internal",
      lastName: "User",
      avatarUrl: null,
    }),
  };
}

function repository(): ClientInvitationRepository {
  return {
    actorOwnsEmail: vi.fn(async () => false),
    listAuthorized: vi.fn(async (_scope, organizationId) => organizationId === ORG_A ? [invitation] : null),
    reserve: vi.fn(async () => invitation),
    finalizeDelivery: vi.fn(async () => invitation),
    cancelDelivery: vi.fn(async () => undefined),
    grantExisting: vi.fn(async () => ({ kind: "not_found" as const })),
    beginResend: vi.fn(async () => ({ kind: "already_replaced" as const, invitation })),
    finalizeResend: vi.fn(async () => invitation),
    revokeAuthorized: vi.fn(async () => invitation),
    claim: vi.fn(async () => ({ kind: "not_synchronized" as const })),
  };
}

function gateway(): ClerkInvitationGateway {
  return {
    findVerifiedUserByEmail: vi.fn(async () => null),
    getVerifiedEmails: vi.fn(async () => ["client@example.test"]),
    createInvitation: vi.fn(async () => ({ id: "inv_clerk" })),
    revokeInvitation: vi.fn(async () => undefined),
  };
}

describe("Phase 8A invitation HTTP routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
  });

  it("registers the five endpoints and accepts only email plus a client role", async () => {
    const repo = repository();
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      clientInvitationRepository: repo,
      clerkInvitationGateway: gateway(),
    });
    const routes = app.printRoutes();
    expect(routes).toContain("/invitations (GET, HEAD, POST)");
    expect(routes).toContain("client-invitations/claim (POST)");
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${ORG_A}/invitations`,
      payload: { email: "client@example.test", membershipRole: "client_contact" },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(repo.reserve).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({
      status: expect.anything(),
      clerkUserId: expect.anything(),
    }));

    const manipulated = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${ORG_A}/invitations`,
      payload: {
        email: "client@example.test",
        membershipRole: "admin",
        organizationId: ORG_B,
        status: "accepted",
      },
    });
    expect(manipulated.statusCode).toBe(400);
  });

  it("rejects clients and cross-tenant organization ids before repository mutation", async () => {
    const repo = repository();
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(false),
      clientInvitationRepository: repo,
      clerkInvitationGateway: gateway(),
    });
    expect((await app.inject({ method: "GET", url: `/api/v1/organizations/${ORG_A}/invitations` })).statusCode).toBe(403);
    await app.close();
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true),
      clientInvitationRepository: repo,
      clerkInvitationGateway: gateway(),
    });
    expect((await app.inject({ method: "GET", url: `/api/v1/organizations/${ORG_B}/invitations` })).statusCode).toBe(403);
    expect(repo.listAuthorized).not.toHaveBeenCalled();
  });

  it("claim requires an active Clerk session and exposes delayed webhook sync as retryable 409", async () => {
    const repo = repository();
    app = await buildTestApp({}, {
      authenticationProvider: unauthenticated,
      clientInvitationRepository: repo,
      clerkInvitationGateway: gateway(),
    });
    const missingSession = await app.inject({
      method: "POST",
      url: "/api/v1/client-invitations/claim",
      payload: { invitationId: INVITATION_ID },
    });
    expect(missingSession.statusCode).toBe(401);
    await app.close();

    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      clientInvitationRepository: repo,
      clerkInvitationGateway: gateway(),
    });
    const pending = await app.inject({
      method: "POST",
      url: "/api/v1/client-invitations/claim",
      payload: { invitationId: INVITATION_ID },
    });
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toMatchObject({
      error: { code: "PROFILE_NOT_SYNCHRONIZED", details: { retryable: true } },
    });
  });

  it("maps missing and invalid-state actions to 404/409", async () => {
    const repo = repository();
    vi.mocked(repo.beginResend).mockResolvedValue({ kind: "not_found" });
    vi.mocked(repo.revokeAuthorized).mockResolvedValue("invalid_state");
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      clientInvitationRepository: repo,
      clerkInvitationGateway: gateway(),
    });
    expect((await app.inject({ method: "POST", url: `/api/v1/organizations/${ORG_A}/invitations/${INVITATION_ID}/resend` })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/v1/organizations/${ORG_A}/invitations/${INVITATION_ID}/revoke` })).statusCode).toBe(409);
  });

  it("rate limits abusive resend attempts", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      clientInvitationRepository: repository(),
      clerkInvitationGateway: gateway(),
    });
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${ORG_A}/invitations/${INVITATION_ID}/resend`,
      }));
    }
    expect(responses.slice(0, 5).every((response) => response.statusCode === 200)).toBe(true);
    expect(responses[5]!.statusCode).toBe(429);
    expect(responses[5]!.headers["retry-after"]).toBeDefined();
  });
});
