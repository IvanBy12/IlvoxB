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

describe("Phase 5 OpenAPI", () => {
  it("contains exactly the implemented Phase 5 operations and 43 total operations", () => {
    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => methods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`));
    expect(document.info.version).toBe("0.5.0");
    expect(operations).toHaveLength(43);
    expect(phase5Operations.every((operation) => operations.includes(operation))).toBe(true);
    expect(phase5Operations).toHaveLength(23);
  });

  it("does not add Phase 5 ticket, comment, file, or deletion routes", () => {
    const phase5Paths = Object.keys(document.paths)
      .filter((path) => path.startsWith("/projects") || path.startsWith("/tasks"));
    expect(phase5Paths.some((path) => /ticket|comment|file/i.test(path))).toBe(false);
    expect(phase5Paths.some((path) => "delete" in document.paths[path]!)).toBe(false);
  });
});
