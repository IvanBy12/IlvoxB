import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const document = JSON.parse(readFileSync("docs/openapi.json", "utf8")) as {
  readonly info: { readonly version: string };
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const phase5Operations = [
  "GET /projects",
  "POST /projects",
  "GET /projects/{projectId}",
  "PATCH /projects/{projectId}",
  "POST /projects/{projectId}/assign",
  "POST /projects/{projectId}/transition",
  "GET /projects/{projectId}/members",
  "POST /projects/{projectId}/members",
  "PATCH /projects/{projectId}/members/{memberId}",
  "POST /projects/{projectId}/members/{memberId}/revoke",
  "GET /projects/{projectId}/milestones",
  "POST /projects/{projectId}/milestones",
  "GET /projects/{projectId}/milestones/{milestoneId}",
  "PATCH /projects/{projectId}/milestones/{milestoneId}",
  "GET /projects/{projectId}/deliverables",
  "POST /projects/{projectId}/deliverables",
  "GET /projects/{projectId}/deliverables/{deliverableId}",
  "PATCH /projects/{projectId}/deliverables/{deliverableId}",
  "GET /tasks",
  "POST /tasks",
  "GET /tasks/{taskId}",
  "PATCH /tasks/{taskId}",
  "POST /tasks/{taskId}/assign",
  "POST /tasks/{taskId}/transition",
] as const;
const phase6Operations = [
  "GET /tickets",
  "POST /tickets",
  "GET /tickets/{ticketId}",
  "PATCH /tickets/{ticketId}",
  "POST /tickets/{ticketId}/assign",
  "POST /tickets/{ticketId}/priority",
  "POST /tickets/{ticketId}/transition",
  "POST /tickets/{ticketId}/confirm",
  "POST /tickets/{ticketId}/reopen",
  "GET /tickets/{ticketId}/comments",
  "POST /tickets/{ticketId}/comments",
] as const;

describe("Phase 6 OpenAPI", () => {
  it("retains Phase 5 and adds exactly the eleven implemented ticket operations", () => {
    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => methods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`));
    expect(document.info.version).toBe("0.6.0");
    expect(operations).toHaveLength(55);
    expect(phase5Operations.every((operation) => operations.includes(operation))).toBe(true);
    expect(phase6Operations.every((operation) => operations.includes(operation))).toBe(true);
    expect(phase5Operations).toHaveLength(24);
  });

  it("does not add file or deletion routes and documents milestoneId on deliverables only", () => {
    const schemas = (document as unknown as {
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    }).components.schemas;
    expect(Object.keys(document.paths).some((path) => /file|upload|download/i.test(path))).toBe(false);
    expect(Object.values(document.paths).some((path) => "delete" in path)).toBe(false);
    expect(schemas.MilestoneCreate?.properties).not.toHaveProperty("milestoneId");
    expect(schemas.MilestonePatch?.properties).not.toHaveProperty("milestoneId");
    expect(schemas.DeliverableCreate?.properties).toHaveProperty("milestoneId");
    expect(schemas.DeliverablePatch?.properties).toHaveProperty("milestoneId");
  });
});
