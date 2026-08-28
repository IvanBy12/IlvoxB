import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schemaTables } from "../../src/db/schema/index.js";

const EXPECTED_TABLES = [
  "app_users",
  "audit_events",
  "deliverables",
  "diagnostic_option_need_points",
  "diagnostic_options",
  "diagnostic_questions",
  "diagnostic_rule_sets",
  "diagnostic_runs",
  "email_notifications",
  "files",
  "identity_webhook_events",
  "internal_user_invitations",
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
  "service_need_links",
  "service_needs",
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
    expect(new Set(actualTables).size).toBe(29);
  });
});
