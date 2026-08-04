import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schemaTables } from "../../src/db/schema/index.js";

const EXPECTED_TABLES = [
  "app_users",
  "audit_events",
  "deliverables",
  "files",
  "identity_webhook_events",
  "leads",
  "organization_invitations",
  "organization_memberships",
  "organizations",
  "permissions",
  "project_members",
  "project_milestones",
  "projects",
  "role_permissions",
  "roles",
  "services",
  "tasks",
  "ticket_comments",
  "tickets",
  "user_roles",
] as const;

describe("database schema", () => {
  it("maps every table in the authoritative SQL exactly once", () => {
    const actualTables = schemaTables.map((table) => getTableName(table)).toSorted();

    expect(actualTables).toEqual([...EXPECTED_TABLES]);
    expect(new Set(actualTables).size).toBe(20);
  });
});
