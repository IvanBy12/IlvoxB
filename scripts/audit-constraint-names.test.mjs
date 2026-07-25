import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConstraintAudit,
  classifyLeadConversionCheck,
  compareConstraintNames,
  extractExportedConstraintNames,
} from "./audit-constraint-names.lib.mjs";

const exportedSql = `
  CREATE TABLE "leads" (
    CONSTRAINT "chk_leads_conversion" CHECK (true),
    CONSTRAINT "uq_leads_email" UNIQUE("email")
  );
  ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_service"
    FOREIGN KEY ("service_id") REFERENCES "services"("id");
`;
const closureExportedSql = `${exportedSql}
  CREATE TABLE "project_members" (
    CONSTRAINT "chk_project_members_status" CHECK (true),
    CONSTRAINT "chk_project_members_revocation" CHECK (true)
  );
  ALTER TABLE "project_members" ADD CONSTRAINT "project_members_revoked_by_user_id_fkey"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "app_users"("id");
  ALTER TABLE "deliverables" ADD CONSTRAINT "fk_deliverables_milestone_project"
    FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id");
  CREATE TABLE "project_milestones" (
    CONSTRAINT "uq_project_milestones_id_project_organization" UNIQUE("id", "project_id", "organization_id")
  );
`;

const prePhase45Definition = `
  CHECK (
    (status = 'converted' AND converted_organization_id IS NOT NULL AND converted_at IS NOT NULL)
    OR
    (status <> 'converted' AND converted_organization_id IS NULL AND converted_at IS NULL)
  )
`;
const phase45Definition = `
  CHECK (
    (status = 'converted' AND converted_at IS NOT NULL)
    OR
    (status <> 'converted' AND converted_at IS NULL AND converted_organization_id IS NULL)
  )
`;

function physical(definition = phase45Definition) {
  return [
    { contype: "c", conname: "chk_leads_conversion", definition },
    { contype: "f", conname: "fk_leads_service", definition: "FOREIGN KEY" },
    { contype: "u", conname: "uq_leads_email", definition: "UNIQUE" },
  ];
}

test("extracts all named constraint types from the Drizzle export", () => {
  assert.deepEqual(extractExportedConstraintNames(exportedSql), {
    checks: ["chk_leads_conversion"],
    foreignKeys: ["fk_leads_service"],
    uniqueConstraints: ["uq_leads_email"],
    duplicateNames: [],
  });
});

test("reports both missing and unexpected physical constraints", () => {
  assert.deepEqual(compareConstraintNames(["actual", "shared"], ["expected", "shared"]), {
    actual: 2,
    expected: 2,
    missingInDatabase: ["expected"],
    unexpectedInDatabase: ["actual"],
  });
});

test("accepts the lead conversion check before and after migration 0004", () => {
  assert.equal(classifyLeadConversionCheck(prePhase45Definition), "pre_phase45");
  assert.equal(classifyLeadConversionCheck(phase45Definition), "phase45");
  for (const definition of [prePhase45Definition, phase45Definition]) {
    const result = buildConstraintAudit({
      exportedSql,
      physicalConstraints: physical(definition),
      duplicatePhysicalIndexes: [],
      validationSchemas: 0,
    });
    assert.equal(result.ok, true);
    assert.equal(result.checks.actual, 1);
    assert.equal(result.checks.expected, 1);
  }
});

test("fails for drift, duplicate indexes, residual schemas, or an unknown lead check", () => {
  const result = buildConstraintAudit({
    exportedSql,
    physicalConstraints: physical("CHECK (status IS NOT NULL)").slice(0, 2),
    duplicatePhysicalIndexes: [["idx_one", "idx_two"]],
    validationSchemas: 1,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.uniqueConstraints.missingInDatabase, ["uq_leads_email"]);
  assert.equal(result.leadConversionCheck.phase, "unexpected");
});

test("accepts only the complete pending Phase 5 closure constraint set", () => {
  const allowedPendingConstraints = {
    checks: ["chk_project_members_revocation", "chk_project_members_status"],
    foreignKeys: [
      "fk_deliverables_milestone_project",
      "project_members_revoked_by_user_id_fkey",
    ],
    uniqueConstraints: ["uq_project_milestones_id_project_organization"],
  };
  const pending = buildConstraintAudit({
    exportedSql: closureExportedSql,
    physicalConstraints: physical(),
    duplicatePhysicalIndexes: [],
    validationSchemas: 0,
    allowedPendingConstraints,
    phase5ClosureArtifacts: { columns: 0, indexes: 0 },
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.pendingMode, "phase5_closure_pending");

  const partial = buildConstraintAudit({
    exportedSql: closureExportedSql,
    physicalConstraints: [
      ...physical(),
      { contype: "c", conname: "chk_project_members_status", definition: "CHECK (true)" },
    ],
    duplicatePhysicalIndexes: [],
    validationSchemas: 0,
    allowedPendingConstraints,
    phase5ClosureArtifacts: { columns: 1, indexes: 0 },
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.pendingMode, "drift");
});

test("rejects Phase 5 columns or indexes applied without the complete constraint set", () => {
  const result = buildConstraintAudit({
    exportedSql: closureExportedSql,
    physicalConstraints: physical(),
    duplicatePhysicalIndexes: [],
    validationSchemas: 0,
    allowedPendingConstraints: {
      checks: ["chk_project_members_revocation", "chk_project_members_status"],
      foreignKeys: [
        "fk_deliverables_milestone_project",
        "project_members_revoked_by_user_id_fkey",
      ],
      uniqueConstraints: ["uq_project_milestones_id_project_organization"],
    },
    phase5ClosureArtifacts: { columns: 4, indexes: 2 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.pendingMode, "phase5_closure_pending");
  assert.equal(result.phase5ClosureArtifacts.mode, "applied");
});
