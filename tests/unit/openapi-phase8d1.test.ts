/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- focused document assertions. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 8D.1 OpenAPI contract", () => {
  it("documents the administrative catalog and contextual eligibility", async () => {
    const document = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(document.info.version).toBe("0.8.4");
    expect(document.paths["/users"].get["x-permission"]).toBe("users.manage");
    expect(document.paths["/users/{userId}"].get.parameters[0].name).toBe("userId");
    expect(document.paths["/users/eligible"].get["x-neutral-scope"]).toContain("404");
    expect(document.components.schemas.EligibleUserPurpose.enum).toHaveLength(6);
    expect(document.components.schemas.EligibleUser.properties).not.toHaveProperty("clerkUserId");
  });
});
