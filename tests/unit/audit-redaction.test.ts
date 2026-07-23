import { describe, expect, it } from "vitest";
import { safeAuditValues } from "../../src/common/audit/audit.js";

describe("audit redaction", () => {
  it("removes contact data and complete descriptions", () => {
    expect(safeAuditValues({
      status: "pending",
      email: "private@example.test",
      phone: "+57 300 000 0000",
      description: "Operational detail",
    })).toEqual({ status: "pending" });
  });
});
