/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method -- Fastify JSON and repository mocks are intentional. */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import type { UserCatalogDetail, UserCatalogRepository } from "../../src/modules/users/user-catalog.types.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { actor, USER_A, USER_B } from "../helpers/actors.js";

const authenticated: AuthenticationProvider = { authenticate: () => Promise.resolve({ clerkUserId: "clerk_manager" }) };
const now = new Date("2026-08-27T12:00:00.000Z");
const user: UserCatalogDetail = { id: USER_B, displayName: "Colaborador", email: "staff@example.test", status: "active", isInternal: true, roles: ["contributor"], internalRoles: ["contributor"], hasClientAccess: true, createdAt: now, lastAccessAt: null, identitySynchronized: true, effectivePermissions: ["projects.read", "tasks.read"] };
const managerPermissions = [{ code: "users.manage", scopes: ["global" as const] }];

function identity(internal = true, permissions = managerPermissions): IdentityRepository {
  return { findByClerkUserId: () => Promise.resolve({ actor: { ...actor({ internal, permissions }), localUserId: USER_A, clerkUserId: "clerk_manager" }, primaryEmail: "manager@example.test", firstName: "Manager", lastName: null, avatarUrl: null }) };
}

function repository(): UserCatalogRepository {
  return {
    list: vi.fn<UserCatalogRepository["list"]>((input) => Promise.resolve({ items: [user], pagination: { page: input.page, pageSize: input.pageSize, total: 1, totalPages: 1 }, summary: { active: 1, pending: 0, blocked: 0, deleted: 0 } })),
    findById: vi.fn<UserCatalogRepository["findById"]>((id) => Promise.resolve(id === USER_B ? user : null)),
    activate: vi.fn<UserCatalogRepository["activate"]>(() => Promise.resolve({ kind: "changed", user })),
    block: vi.fn<UserCatalogRepository["block"]>(() => Promise.resolve({ kind: "changed", user: { ...user, status: "blocked" } })),
    grantRole: vi.fn<UserCatalogRepository["grantRole"]>(() => Promise.resolve({ kind: "changed", user: { ...user, internalRoles: ["contributor", "support_agent"] } })),
    revokeRole: vi.fn<UserCatalogRepository["revokeRole"]>(() => Promise.resolve({ kind: "changed", user })),
    resolveContext: vi.fn<UserCatalogRepository["resolveContext"]>(() => Promise.resolve({})),
    listEligible: vi.fn<UserCatalogRepository["listEligible"]>(() => Promise.resolve([])),
  };
}

describe("Phase 8D.3 Personal HTTP", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it("returns internal summary and detail with PostgreSQL-derived permissions without Clerk identifiers", async () => {
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), userCatalogRepository: repository() });
    const list = await app.inject({ method: "GET", url: "/api/v1/users?type=internal&page=1&pageSize=10" });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.summary).toEqual({ active: 1, pending: 0, blocked: 0, deleted: 0 });
    const detail = await app.inject({ method: "GET", url: `/api/v1/users/${USER_B}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({ internalRoles: ["contributor"], hasClientAccess: true, identitySynchronized: true, effectivePermissions: ["projects.read", "tasks.read"] });
    expect(JSON.stringify(detail.json())).not.toContain("clerk");
  });

  it("exposes idempotent intentional state and role endpoints", async () => {
    const repo = repository();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), userCatalogRepository: repo });
    expect((await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/block` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/activate` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/roles`, payload: { roleCode: "support_agent" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/users/${USER_B}/roles/support_agent` })).statusCode).toBe(200);
    expect(repo.block).toHaveBeenCalledWith(USER_B, USER_A, expect.objectContaining({ requestId: expect.any(String) }));
  });

  it("returns 401/403/404/409 and rejects arbitrary role bodies", async () => {
    app = await buildTestApp({}, { userCatalogRepository: repository() });
    expect((await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/block` })).statusCode).toBe(401);
    await app.close();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(false), userCatalogRepository: repository() });
    expect((await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/block` })).statusCode).toBe(403);
    await app.close();
    const repo = repository();
    vi.mocked(repo.block).mockResolvedValue({ kind: "last_administrator" });
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), userCatalogRepository: repo });
    const protectedResponse = await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/block` });
    expect(protectedResponse.statusCode).toBe(409);
    expect(protectedResponse.json()).toMatchObject({ error: { code: "LAST_ADMINISTRATOR_PROTECTED", details: { reason: "last_administrator" } } });
    expect((await app.inject({ method: "GET", url: `/api/v1/users/${USER_A}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/v1/users/${USER_B}/roles`, payload: { roleCode: "contributor", permissions: ["users.manage"] } })).statusCode).toBe(400);
  });
});
