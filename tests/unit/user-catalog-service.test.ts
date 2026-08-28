/* eslint-disable @typescript-eslint/unbound-method -- repository interface methods are Vitest mocks in this unit test. */
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import { UserCatalogService } from "../../src/modules/users/user-catalog.service.js";
import type { EligibilityContext, UserCatalogDetail, UserCatalogRepository } from "../../src/modules/users/user-catalog.types.js";
import { actor, ORG_A, USER_A } from "../helpers/actors.js";

const PROJECT = "00000000-0000-4000-8000-000000000501";
const TICKET = "00000000-0000-4000-8000-000000000502";
const TASK = "00000000-0000-4000-8000-000000000503";
const LEAD = "00000000-0000-4000-8000-000000000504";
const now = new Date("2026-08-26T12:00:00.000Z");

function repository(): UserCatalogRepository {
  const catalogItem = {
    id: USER_A,
    displayName: "Owner",
    email: "owner@example.test",
    status: "active",
    isInternal: true,
    roles: ["super_admin"],
    internalRoles: ["super_admin"],
    hasClientAccess: false,
    createdAt: now,
    lastAccessAt: null,
    identitySynchronized: true,
    effectivePermissions: ["users.manage"],
  } satisfies UserCatalogDetail;
  return {
    list: vi.fn<UserCatalogRepository["list"]>((input) => Promise.resolve({ items: [catalogItem], pagination: { ...input, total: 1, totalPages: 1 }, summary: { active: 1, pending: 0, blocked: 0, deleted: 0 } })),
    findById: vi.fn<UserCatalogRepository["findById"]>(() => Promise.resolve(catalogItem)),
    activate: vi.fn<UserCatalogRepository["activate"]>(() => Promise.resolve({ kind: "unchanged", user: catalogItem })),
    block: vi.fn<UserCatalogRepository["block"]>(() => Promise.resolve({ kind: "changed", user: { ...catalogItem, status: "blocked" } })),
    grantRole: vi.fn<UserCatalogRepository["grantRole"]>(() => Promise.resolve({ kind: "unchanged", user: catalogItem })),
    revokeRole: vi.fn<UserCatalogRepository["revokeRole"]>(() => Promise.resolve({ kind: "unchanged", user: catalogItem })),
    resolveContext: vi.fn<UserCatalogRepository["resolveContext"]>((_scope, input: EligibilityContext) => Promise.resolve({
      ...(input.organizationId === undefined && input.projectId === undefined && input.taskId === undefined && input.ticketId === undefined ? {} : { organizationId: ORG_A }),
      ...(input.projectId === undefined && input.taskId === undefined && input.ticketId === undefined ? {} : { projectId: PROJECT }),
    })),
    listEligible: vi.fn<UserCatalogRepository["listEligible"]>(() => Promise.resolve([{ id: USER_A, displayName: "Owner", email: "owner@example.test", roles: ["super_admin"] }])),
  };
}

const permissions = [
  { code: "users.manage", scopes: ["global" as const] },
  { code: "organizations.manage", scopes: ["global" as const] },
  { code: "projects.manage", scopes: ["global" as const] },
  { code: "tasks.manage", scopes: ["global" as const] },
  { code: "tickets.assign", scopes: ["global" as const] },
  { code: "leads.manage", scopes: ["global" as const] },
];

describe("user catalog service", () => {
  it("supports the complete catalog with the existing users.manage capability", async () => {
    const repo = repository();
    const service = new UserCatalogService(repo, new AuthorizationService());
    const result = await service.list(actor({ internal: true, permissions }), { page: 1, pageSize: 20, sortBy: "createdAt", sortDirection: "desc" });
    expect(result.items[0]).toMatchObject({ id: USER_A, lastAccessAt: null });
    const list = vi.mocked(repo.list);
    expect(list).toHaveBeenCalledOnce();
  });

  it.each([
    ["organization_account_manager", { organizationId: ORG_A }],
    ["project_lead", { projectId: PROJECT }],
    ["project_member", { projectId: PROJECT }],
    ["task_assignee", { taskId: TASK }],
    ["ticket_assignee", { ticketId: TICKET }],
    ["lead_assignee", { leadId: LEAD }],
  ] as const)("returns the single internal operator for %s", async (purpose, context) => {
    const repo = repository();
    const service = new UserCatalogService(repo, new AuthorizationService());
    const result = await service.eligible(actor({ internal: true, permissions }), { purpose, ...context });
    expect(result.items).toEqual([{ id: USER_A, displayName: "Owner", email: "owner@example.test", roles: ["super_admin"] }]);
  });

  it("rejects clients, missing permissions, and incompatible context", async () => {
    const repo = repository();
    const service = new UserCatalogService(repo, new AuthorizationService());
    expect(() => service.list(actor({ internal: false, permissions }), { page: 1, pageSize: 20, sortBy: "createdAt", sortDirection: "desc" })).toThrow(expect.objectContaining({ statusCode: 403 }));
    await expect(service.eligible(actor({ internal: true }), { purpose: "ticket_assignee", ticketId: TICKET })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.eligible(actor({ internal: true, permissions }), { purpose: "project_member", organizationId: ORG_A })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("manages intentional status transitions and roles with users.manage", async () => {
    const repo = repository();
    const service = new UserCatalogService(repo, new AuthorizationService());
    const manager = actor({ internal: true, permissions });
    await expect(service.block(manager, USER_A, { requestId: USER_A })).resolves.toMatchObject({ kind: "changed", user: { status: "blocked" } });
    await expect(service.activate(manager, USER_A, { requestId: USER_A })).resolves.toMatchObject({ kind: "unchanged" });
    await expect(service.grantRole(manager, USER_A, "contributor", { requestId: USER_A })).resolves.toMatchObject({ kind: "unchanged" });
    await expect(service.revokeRole(manager, USER_A, "contributor", { requestId: USER_A })).resolves.toMatchObject({ kind: "unchanged" });
  });

  it("maps neutral targets, invalid roles, terminal users, and last-administrator protection", async () => {
    const repo = repository();
    const service = new UserCatalogService(repo, new AuthorizationService());
    const manager = actor({ internal: true, permissions });
    vi.mocked(repo.block).mockResolvedValueOnce({ kind: "last_administrator" });
    await expect(service.block(manager, USER_A, { requestId: USER_A })).rejects.toMatchObject({ statusCode: 409, code: "LAST_ADMINISTRATOR_PROTECTED" });
    vi.mocked(repo.activate).mockResolvedValueOnce({ kind: "not_found" });
    await expect(service.activate(manager, USER_A, { requestId: USER_A })).rejects.toMatchObject({ statusCode: 404 });
    vi.mocked(repo.grantRole).mockResolvedValueOnce({ kind: "role_not_assignable" });
    await expect(service.grantRole(manager, USER_A, "client_contact", { requestId: USER_A })).rejects.toMatchObject({ statusCode: 400 });
    vi.mocked(repo.revokeRole).mockResolvedValueOnce({ kind: "protected_role" });
    await expect(service.revokeRole(manager, USER_A, "super_admin", { requestId: USER_A })).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each([
    ["organization_account_manager", { organizationId: ORG_A }],
    ["project_lead", { projectId: PROJECT }],
    ["project_member", { projectId: PROJECT }],
    ["task_assignee", { taskId: TASK }],
    ["ticket_assignee", { ticketId: TICKET }],
    ["lead_assignee", { leadId: LEAD }],
  ] as const)("keeps an out-of-scope context neutral for %s", async (purpose, context) => {
    const repo = repository();
    const resolveContext = vi.mocked(repo.resolveContext);
    resolveContext.mockResolvedValue(null);
    const service = new UserCatalogService(repo, new AuthorizationService());
    await expect(service.eligible(actor({ internal: true, permissions }), { purpose, ...context })).rejects.toMatchObject({ statusCode: 404 });
  });
});
