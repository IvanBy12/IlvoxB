/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- focused OpenAPI assertions. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 8D.2 OpenAPI contract", () => {
  it("documents separate internal roles, invitation lifecycle and claim", async () => {
    const document = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(document.info.version).toBe("0.8.5");
    expect(document.paths["/internal-roles"].get["x-permission"]).toBe("users.manage");
    expect(document.paths["/internal-invitations"].post.requestBody.content["application/json"].schema.$ref).toContain("InternalInvitationCreate");
    expect(document.paths["/internal-invitations/{invitationId}/resend"].post["x-rate-limit"]).toBe("5 per hour");
    expect(document.paths["/internal-invitations/claim"].post["x-separated-from"]).toBe("/client-invitations/claim");
    expect(document.components.schemas.InternalInvitationCreate.additionalProperties).toBe(false);
    expect(document.components.schemas.InternalInvitation.properties).not.toHaveProperty("clerkInvitationId");
  });
});
