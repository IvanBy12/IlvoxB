/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Focused OpenAPI structure assertions. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 8B OpenAPI contract", () => {
  it("documents the complete service-needs surface and permissions", async () => {
    const document = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(document.info.version).toBe("0.8.2");
    expect(document.paths["/service-needs"].get.security).toEqual([]);
    expect(document.paths["/service-needs/{needId}/services"].get["x-rate-limit"]).toBe("60 per minute");
    expect(document.paths["/admin/service-needs"].get["x-permission"]).toBe("services.read");
    expect(document.paths["/admin/service-needs"].post["x-permission"]).toBe("services.manage");
    expect(document.paths["/admin/service-needs/{needId}/services"].put.summary).toContain("Transactionally");
    expect(document.components.schemas.ServiceNeedLinksReplace.properties.services.items.properties.weight.maximum).toBe(100);
  });
});
