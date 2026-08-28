/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method -- Fastify JSON is dynamic and repository interface methods are Vitest mocks here. */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import type { UserCatalogRepository } from "../../src/modules/users/user-catalog.types.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { actor, ORG_A, USER_A } from "../helpers/actors.js";

const PROJECT = "00000000-0000-4000-8000-000000000501";
const now = new Date("2026-08-26T12:00:00.000Z");
const authenticated: AuthenticationProvider = { authenticate: () => Promise.resolve({ clerkUserId: "clerk_test" }) };
const permissions = [
  { code: "users.manage", scopes: ["global" as const] },
  { code: "organizations.manage", scopes: ["global" as const] },
  { code: "projects.manage", scopes: ["global" as const] },
];

function identity(internal = true, granted = permissions): IdentityRepository {
  return { findByClerkUserId: () => Promise.resolve({
    actor: { ...actor({ internal, permissions: granted }), clerkUserId: "clerk_test" },
    primaryEmail: "owner@example.test", firstName: "Owner", lastName: null, avatarUrl: null,
  }) };
}

function repository(): UserCatalogRepository {
  const item = { id: USER_A, displayName: "Owner", email: "owner@example.test", status: "active" as const, isInternal: true, roles: ["super_admin"], internalRoles: ["super_admin"], hasClientAccess: false, createdAt: now, lastAccessAt: null, identitySynchronized: true, effectivePermissions: ["users.manage"] };
  return {
    list: vi.fn<UserCatalogRepository["list"]>((input) => Promise.resolve({ items: [item], pagination: { ...input, total: 1, totalPages: 1 }, summary: { active: 1, pending: 0, blocked: 0, deleted: 0 } })),
    findById: vi.fn<UserCatalogRepository["findById"]>((id) => Promise.resolve(id === USER_A ? item : null)),
    activate: vi.fn<UserCatalogRepository["activate"]>(() => Promise.resolve({ kind: "unchanged", user: item })),
    block: vi.fn<UserCatalogRepository["block"]>(() => Promise.resolve({ kind: "changed", user: { ...item, status: "blocked" } })),
    grantRole: vi.fn<UserCatalogRepository["grantRole"]>(() => Promise.resolve({ kind: "unchanged", user: item })),
    revokeRole: vi.fn<UserCatalogRepository["revokeRole"]>(() => Promise.resolve({ kind: "unchanged", user: item })),
    resolveContext: vi.fn<UserCatalogRepository["resolveContext"]>(() => Promise.resolve({ organizationId: ORG_A, projectId: PROJECT })),
    listEligible: vi.fn<UserCatalogRepository["listEligible"]>(() => Promise.resolve([{ id: USER_A, displayName: "Owner", email: "owner@example.test", roles: ["super_admin"] }])),
  };
}

describe("Phase 8D.1 user catalog HTTP", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app !== undefined) await app.close(); app = undefined; });

  it("paginates and filters the secure catalog without Clerk data", async () => {
    const repo = repository();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), userCatalogRepository: repo });
    const response = await app.inject({ method: "GET", url: "/api/v1/users?page=2&pageSize=10&search=own&status=active&type=internal&role=super_admin&sortBy=email&sortDirection=asc" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toEqual({ id: USER_A, displayName: "Owner", email: "owner@example.test", status: "active", isInternal: true, roles: ["super_admin"], internalRoles: ["super_admin"], hasClientAccess: false, createdAt: now.toISOString(), lastAccessAt: null });
    expect(JSON.stringify(response.json())).not.toContain("clerkUserId");
    const list = vi.mocked(repo.list);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10, type: "internal", role: "super_admin" }));
  });

  it("exposes contextual candidates and validates strict purpose/context", async () => {
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), userCatalogRepository: repository() });
    const valid = await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=project_member&projectId=${PROJECT}` });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().data.items).toHaveLength(1);
    expect(valid.json().data.items[0]).toEqual({ id: USER_A, displayName: "Owner", email: "owner@example.test", roles: ["super_admin"] });
    expect((await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=invalid&projectId=${PROJECT}` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=project_member&organizationId=${ORG_A}` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=project_member&projectId=${PROJECT}&ticketId=${PROJECT}` })).statusCode).toBe(400);
  });

  it("rejects unauthenticated, client, and internal actors without permission", async () => {
    app = await buildTestApp({}, { userCatalogRepository: repository() });
    expect((await app.inject({ method: "GET", url: "/api/v1/users" })).statusCode).toBe(401);
    await app.close();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(false), userCatalogRepository: repository() });
    expect((await app.inject({ method: "GET", url: "/api/v1/users" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=project_member&projectId=${PROJECT}` })).statusCode).toBe(403);
    await app.close();
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(true, []), userCatalogRepository: repository() });
    expect((await app.inject({ method: "GET", url: "/api/v1/users" })).statusCode).toBe(403);
  });

  it("keeps out-of-scope resources neutral", async () => {
    const repo = repository();
    const resolveContext = vi.mocked(repo.resolveContext);
    resolveContext.mockResolvedValue(null);
    app = await buildTestApp({}, { authenticationProvider: authenticated, identityRepository: identity(), userCatalogRepository: repo });
    const response = await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=project_member&projectId=${PROJECT}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
