/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- focused document assertions. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 8C OpenAPI contract", () => {
  it("documents the public engine, immutable lead snapshot and version administration", async () => {
    const document = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(document.info.version).toBe("0.8.3");
    expect(document.paths["/diagnostic"].get.security).toEqual([]);
    expect(document.paths["/diagnostic/evaluate"].post["x-rate-limit"]).toBe("10 per minute");
    expect(document.paths["/leads/{leadId}/diagnostic"].get["x-permission"]).toBe("leads.read");
    expect(document.paths["/admin/diagnostic/draft"].put["x-permission"]).toBe("services.manage");
    expect(document.paths["/admin/diagnostic/publish"].post.summary).toContain("Transactionally");
    expect(document.components.schemas.DiagnosticEvaluation.additionalProperties).toBe(false);
    expect(document.components.schemas.DiagnosticEvaluation.properties).not.toHaveProperty("serviceId");
  });
});
