import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import { OrganizationService } from "../../src/modules/organizations/organization.service.js";
import type { OrganizationRepository } from "../../src/modules/organizations/organization.types.js";
import { ORG_A, actor } from "../helpers/actors.js";

function repository() {
  const listAuthorized = vi.fn(() => Promise.resolve({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }));
  const updateAuthorized = vi.fn(() => Promise.resolve(null));
  return {
    listAuthorized,
    findAuthorized: vi.fn(() => Promise.resolve(null)),
    create: vi.fn(() => Promise.resolve("duplicate" as const)),
    updateAuthorized,
    listMembers: vi.fn(() => Promise.resolve([])),
    createMember: vi.fn(() => Promise.resolve(null)),
    updateMember: vi.fn(() => Promise.resolve(null)),
  } satisfies OrganizationRepository;
}

const pagination = { page: 1, pageSize: 20 };

describe("organization service scope boundaries", () => {
  it("fails closed on a global list without organizations.access_all or organization grants", () => {
    const repo = repository();
    const service = new OrganizationService(repo, new AuthorizationService());
    const internal = actor({
      internal: true,
      organizations: [],
      permissions: [{ code: "organizations.read", scopes: ["global"] }],
    });
    expect(() => service.list(internal, pagination)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(repo.listAuthorized).not.toHaveBeenCalled();
  });

  it("allows a true cross-organization list only with organizations.access_all", async () => {
    const repo = repository();
    const service = new OrganizationService(repo, new AuthorizationService());
    const superAdmin = actor({
      internal: true,
      roleCode: "super_admin",
      organizations: [],
      permissions: [
        { code: "organizations.read", scopes: ["global"] },
        { code: "organizations.access_all", scopes: ["global"] },
      ],
    });
    await service.list(superAdmin, pagination);
    expect(repo.listAuthorized).toHaveBeenCalledWith(
      { kind: "global", actorId: superAdmin.localUserId, crossOrganization: true },
      pagination,
    );
  });

  it("uses organization scope for a client list", async () => {
    const repo = repository();
    const service = new OrganizationService(repo, new AuthorizationService());
    const client = actor({
      permissions: [{
        code: "organizations.read",
        scopes: ["organization"],
        scopeOrganizationIds: { organization: [ORG_A] },
      }],
    });
    await service.list(client, pagination);
    expect(repo.listAuthorized).toHaveBeenCalledWith(
      { kind: "organization", actorId: client.localUserId, organizationIds: [ORG_A] },
      pagination,
    );
  });

  it("protects legal and operational fields even if a future client write permission is added", async () => {
    const repo = repository();
    const service = new OrganizationService(repo, new AuthorizationService());
    const manager = actor({
      roleCode: "client_manager",
      permissions: [{
        code: "organizations.manage",
        scopes: ["organization"],
        scopeOrganizationIds: { organization: [ORG_A] },
      }],
    });
    await expect(service.update(
      manager,
      ORG_A,
      { status: "archived" },
      { actorUserId: manager.localUserId, organizationId: ORG_A, requestId: "00000000-0000-4000-8000-000000000999" },
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.updateAuthorized).not.toHaveBeenCalled();
  });
});
