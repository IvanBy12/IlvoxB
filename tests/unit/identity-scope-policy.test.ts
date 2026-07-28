import { describe, expect, it } from "vitest";
import { scopesForIdentityRole } from "../../src/modules/identity/identity.repository.js";

describe("identity scope policy", () => {
  it("keeps client contacts assigned to explicit projects", () => {
    expect(
      scopesForIdentityRole({
        role_scope: "organization",
        role_code: "client_contact",
        permission_code: "projects.read",
      }),
    ).toEqual(["assigned"]);
  });

  it("keeps client ticket access own or assigned", () => {
    expect(
      scopesForIdentityRole({
        role_scope: "organization",
        role_code: "client_contact",
        permission_code: "tickets.read",
      }),
    ).toEqual(["own", "assigned"]);
    expect(
      scopesForIdentityRole({
        role_scope: "organization",
        role_code: "client_contact",
        permission_code: "ticket_comments.create_client",
      }),
    ).toEqual(["own", "assigned"]);
  });

  it("uses organization scope for non-ticket organization resources", () => {
    expect(
      scopesForIdentityRole({
        role_scope: "organization",
        role_code: "client_contact",
        permission_code: "organizations.read",
      }),
    ).toEqual(["organization"]);
    expect(
      scopesForIdentityRole({
        role_scope: "organization",
        role_code: "client_contact",
        permission_code: "files.read",
      }),
    ).toEqual(["organization"]);
  });
});
