import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import { isOrganizationInScope } from "../../src/common/auth/scope-filter.js";
import { ORG_A, ORG_B, USER_A, USER_B, actor } from "../helpers/actors.js";

describe("AuthorizationService", () => {
  const service = new AuthorizationService();

  it("denies by default and rejects inactive local states", () => {
    expect(service.can({ actor: actor(), action: "tickets.read" }).reasonCode).toBe("PERMISSION_DENIED");
    for (const status of ["pending", "blocked", "deleted"] as const) {
      expect(service.can({ actor: actor({ status }), action: "tickets.read" }).reasonCode).toBe("ACTOR_INACTIVE");
    }
  });

  it("enforces organization, own and assigned scopes", () => {
    const scoped = actor({ permissions: [{ code: "tickets.read", scopes: ["organization", "own", "assigned"] }] });
    const own = service.can({ actor: scoped, action: "tickets.read", organizationId: ORG_A,
      requestedScope: "own", resourceOwnerId: USER_A });
    expect(own.allowed).toBe(true);
    expect(service.can({ actor: scoped, action: "tickets.read", organizationId: ORG_B,
      requestedScope: "organization" }).reasonCode).toBe("SCOPE_MISMATCH");
    expect(service.can({ actor: scoped, action: "tickets.read", organizationId: ORG_A,
      requestedScope: "assigned", resourceAssigneeIds: [USER_B] }).reasonCode).toBe("RESOURCE_NOT_AUTHORIZED");
  });

  it("requires access_all for a cross-organization global operation", () => {
    const admin = actor({ internal: true, permissions: [{ code: "tickets.read", scopes: ["global"] }] });
    expect(service.can({ actor: admin, action: "tickets.read", organizationId: ORG_B }).allowed).toBe(false);
    const superAdmin = actor({ internal: true, roleCode: "super_admin", permissions: [
      { code: "tickets.read", scopes: ["global"] },
      { code: "organizations.access_all", scopes: ["global"] },
    ] });
    expect(service.can({ actor: superAdmin, action: "tickets.read", organizationId: ORG_B }).allowed).toBe(true);
  });

  it("blocks vertical escalation and self assignment", () => {
    const admin = actor({ internal: true, roleCode: "admin", permissions: [
      { code: "roles.assign_super_admin", scopes: ["global"] },
    ] });
    expect(service.can({ actor: admin, action: "roles.assign_super_admin", requestedScope: "global",
      resourceId: USER_B, requestedRole: { scope: "global", code: "super_admin" } }).reasonCode)
      .toBe("PRIVILEGE_BOUNDARY");
    const superAdmin = actor({ internal: true, roleCode: "super_admin", permissions: [
      { code: "roles.assign_super_admin", scopes: ["global"] },
    ] });
    expect(service.can({ actor: superAdmin, action: "roles.assign_super_admin", requestedScope: "global",
      resourceId: USER_A, requestedRole: { scope: "global", code: "super_admin" } }).allowed).toBe(false);

    const clientManager = actor({ roleCode: "client_manager", permissions: [
      { code: "organization_members.manage", scopes: ["organization"] },
    ] });
    expect(service.can({ actor: clientManager, action: "organization_members.manage", organizationId: ORG_A,
      requestedRole: { scope: "global", code: "admin" } }).reasonCode).toBe("PRIVILEGE_BOUNDARY");
    const contact = actor({ roleCode: "client_contact" });
    expect(service.can({ actor: contact, action: "organization_members.manage", organizationId: ORG_A }).allowed)
      .toBe(false);
  });

  it("keeps permission scope grants bound to the organization that granted them", () => {
    const multiOrg = actor({ organizations: [ORG_A, ORG_B], permissions: [{
      code: "organization_members.manage",
      scopes: ["organization", "own"],
      scopeOrganizationIds: { organization: [ORG_A], own: [ORG_A, ORG_B] },
    }] });
    expect(service.can({ actor: multiOrg, action: "organization_members.manage", organizationId: ORG_A,
      requestedScope: "organization" }).allowed).toBe(true);
    expect(service.can({ actor: multiOrg, action: "organization_members.manage", organizationId: ORG_B,
      requestedScope: "organization" }).allowed).toBe(false);
  });

  it("enforces the real ticket states for client actions", () => {
    const client = actor({ permissions: [
      { code: "tickets.confirm_resolution", scopes: ["organization"] },
      { code: "tickets.reject_resolution", scopes: ["organization"] },
      { code: "tickets.request_reopen", scopes: ["organization"] },
    ] });
    expect(service.can({ actor: client, action: "tickets.confirm_resolution", organizationId: ORG_A,
      resourceState: "resolved" }).allowed).toBe(true);
    expect(service.can({ actor: client, action: "tickets.reject_resolution", organizationId: ORG_A,
      resourceState: "in_progress" }).reasonCode).toBe("RESOURCE_STATE_INVALID");
    expect(service.can({ actor: client, action: "tickets.request_reopen", organizationId: ORG_A,
      resourceState: "resolved" }).allowed).toBe(false);
  });

  it("does not leak organizations through repository scopes", () => {
    const decision = service.assertAllowed({
      actor: actor({ permissions: [{ code: "tickets.read", scopes: ["organization"] }] }),
      action: "tickets.read", organizationId: ORG_A,
    });
    expect(decision.repositoryScope).toBeDefined();
    expect(isOrganizationInScope(decision.repositoryScope!, ORG_A)).toBe(true);
    expect(isOrganizationInScope(decision.repositoryScope!, ORG_B)).toBe(false);
  });
});
