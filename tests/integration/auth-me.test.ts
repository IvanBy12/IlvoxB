import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository, LocalIdentityProfile } from "../../src/modules/identity/identity.types.js";
import { ORG_A, ORG_B, actor } from "../helpers/actors.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const authenticated: AuthenticationProvider = {
  authenticate: () => Promise.resolve({ clerkUserId: "clerk_test" }),
};
const unauthenticated: AuthenticationProvider = { authenticate: () => Promise.resolve(null) };

function repository(profile: LocalIdentityProfile | null): IdentityRepository {
  return { findByClerkUserId: () => Promise.resolve(profile) };
}

function localProfile(overrides: Parameters<typeof actor>[0] = {}): LocalIdentityProfile {
  return {
    actor: { ...actor(overrides), clerkUserId: "clerk_test" },
    primaryEmail: "person@example.test",
    firstName: "Test",
    lastName: "Person",
    avatarUrl: null,
  };
}

describe("authentication context and GET /me", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app !== undefined) await app.close(); app = undefined; });

  for (const scenario of ["missing token", "invalid token", "expired token"] as const) {
    it(`rejects ${scenario}`, async () => {
      app = await buildTestApp({}, { authenticationProvider: unauthenticated, identityRepository: repository(null) });
      const response = await app.inject({ method: "GET", url: "/me" });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    });
  }

  it("rejects a Clerk user without a local profile", async () => {
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: repository(null) });
    const response = await app.inject({ method: "GET", url: "/me" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "PROFILE_NOT_SYNCHRONIZED" },
    });
  });

  it("rejects a pending local user without activating it", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: repository(localProfile({ status: "pending" })),
    });
    const response = await app.inject({ method: "GET", url: "/me" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "PROFILE_PENDING" },
    });
  });

  for (const status of ["blocked", "deleted"] as const) {
    it(`rejects a ${status} local user as inactive`, async () => {
      app = await buildTestApp({}, {
        authenticationProvider: authenticated,
        identityRepository: repository(localProfile({ status })),
      });
      const response = await app.inject({ method: "GET", url: "/me" });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "PROFILE_INACTIVE" },
      });
    });
  }

  it("fails closed for an unsupported inactive status value", async () => {
    const active = localProfile();
    const inactive = { ...active, actor: { ...active.actor, status: "inactive" } } as unknown as LocalIdentityProfile;
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: repository(inactive),
    });
    const response = await app.inject({ method: "GET", url: "/me" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "PROFILE_INACTIVE" },
    });
  });

  it("returns an active internal actor without secrets", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: repository(localProfile({ internal: true, roleCode: "admin", permissions: [
        { code: "tickets.create", scopes: ["global"] },
      ] })),
    });
    const response = await app.inject({ method: "GET", url: "/me" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: {
      user: { status: "active", internal: true },
      capabilities: { canCreateTicket: true, canManageMembers: false },
    } });
    expect(response.body).not.toMatch(/token|secret|metadata/i);
  });

  it("returns only validated active memberships for a multi-organization client", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: repository(localProfile({ organizations: [ORG_A, ORG_B], permissions: [
        { code: "files.read_client", scopes: ["own", "assigned"] },
      ] })),
    });
    const body = (await app.inject({ method: "GET", url: "/me" })).json<{
      data: { organizations: { id: string }[]; effectivePermissions: { code: string; scopes: string[] }[] };
    }>();
    expect(body.data.organizations.map((organization) => organization.id)).toEqual([ORG_A, ORG_B]);
    expect(body.data.effectivePermissions).toContainEqual({ code: "files.read_client", scopes: ["own", "assigned"] });
  });

  it("allows an active local user with no organization without inventing membership", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: repository(localProfile({ organizations: [] })),
    });
    const response = await app.inject({ method: "GET", url: "/me" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { organizations: [] } });
  });
});
