/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- The JSON OpenAPI document is validated structurally in this focused test. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 8A OpenAPI contract", () => {
  it("documents the invitation surface without organization or role in claim", async () => {
    const document = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(document.paths["/organizations/{organizationId}/invitations"]).toBeDefined();
    expect(document.paths["/organizations/{organizationId}/invitations/{invitationId}/resend"]).toBeDefined();
    expect(document.paths["/organizations/{organizationId}/invitations/{invitationId}/revoke"]).toBeDefined();
    const claim = document.paths["/client-invitations/claim"].post;
    const schema = claim.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(["invitationId"]);
    expect(Object.keys(schema.properties)).toEqual(["invitationId"]);
    expect(claim["x-rate-limit"]).toBe("10 per minute");
  });
});
