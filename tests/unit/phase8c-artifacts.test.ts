import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { diagnosticOptionNeedPoints, diagnosticRuleSets, diagnosticRuns } from "../../src/db/schema/diagnostics.js";

describe("Phase 8C artifacts", () => {
  it("enforces version, immutable relationships, positive points and one claimed lead", () => {
    const ruleSets = getTableConfig(diagnosticRuleSets);
    const points = getTableConfig(diagnosticOptionNeedPoints);
    const runs = getTableConfig(diagnosticRuns);
    expect(ruleSets.uniqueConstraints.some((constraint) => constraint.name === "diagnostic_rule_sets_version_key")).toBe(true);
    expect(ruleSets.indexes.some((index) => index.config.name === "diagnostic_rule_sets_one_published_idx")).toBe(true);
    expect(points.uniqueConstraints.some((constraint) => constraint.name === "diagnostic_option_need_points_option_need_key")).toBe(true);
    expect(points.foreignKeys.every((foreignKey) => foreignKey.onDelete === "restrict")).toBe(true);
    expect(points.checks.some((constraint) => constraint.name === "chk_diagnostic_option_need_points_positive")).toBe(true);
    expect(runs.uniqueConstraints.some((constraint) => constraint.name === "diagnostic_runs_lead_id_key")).toBe(true);
  });

  it("tracks migration, idempotent seed and focused cleanup", async () => {
    const [migration, journal, seed, smoke] = await Promise.all([
      readFile(new URL("../../drizzle/migrations/0011_phase8c-diagnostic-engine.sql", import.meta.url), "utf8"),
      readFile(new URL("../../drizzle/migrations/meta/_journal.json", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/seed-diagnostic.ts", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/smoke-phase8c-diagnostic.ts", import.meta.url), "utf8"),
    ]);
    expect(migration).toContain('CREATE TABLE "diagnostic_rule_sets"');
    expect(migration).toContain('CREATE TABLE "diagnostic_runs"');
    expect(journal).toContain('"tag": "0011_phase8c-diagnostic-engine"');
    expect(seed).toContain("SELECT 1 FROM diagnostic_rule_sets LIMIT 1");
    expect(seed).toContain("questions.length");
    expect(smoke).toContain("PHASE8C_SMOKE_");
    expect(smoke).toContain("residualFixtures");
  });
});
