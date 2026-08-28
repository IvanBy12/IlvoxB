/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- OpenAPI JSON is intentionally dynamic. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 8D.3 OpenAPI", () => {
  it("documents only the real Personal contracts and protection boundary", async () => {
    const document = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(document.info.version).toBe("0.8.5");
    expect(document.paths["/users/{userId}"].get.description).toContain("effective PostgreSQL permissions");
    expect(document.paths["/users/{userId}/activate"].post["x-permission"]).toBe("users.manage");
    expect(document.paths["/users/{userId}/block"].post.description).toContain("last active administrator");
    expect(document.paths["/users/{userId}/roles"].post.requestBody.content["application/json"].schema.$ref).toContain("InternalUserRoleGrant");
    expect(document.paths["/users/{userId}/roles/{roleCode}"].delete.description).toContain("super_admin");
    expect(document.components.schemas.InternalUserRoleGrant.additionalProperties).toBe(false);
    expect(JSON.stringify(document.paths["/users/{userId}/roles"])).not.toContain("permissions");
  });
});
