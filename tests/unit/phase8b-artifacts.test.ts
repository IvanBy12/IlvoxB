import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { serviceNeedLinks, serviceNeeds } from "../../src/db/schema/service-needs.js";

const expectedCodes = [
  "sell_online",
  "digital_presence",
  "business_automation",
  "customer_management",
  "system_improvement",
  "system_integration",
  "data_insights",
  "technical_support",
  "cybersecurity",
  "not_sure",
] as const;

describe("Phase 8B schema and operational artifacts", () => {
  it("keeps code unique and enforces relationship integrity", () => {
    const needs = getTableConfig(serviceNeeds);
    const links = getTableConfig(serviceNeedLinks);
    expect(needs.uniqueConstraints.map((constraint) => constraint.name)).toEqual(["service_needs_code_key"]);
    expect(links.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["need_id", "service_id"]);
    expect(links.foreignKeys.every((foreignKey) => foreignKey.onDelete === "restrict")).toBe(true);
    expect(links.checks.some((constraint) => constraint.name === "chk_service_need_links_weight")).toBe(true);
  });

  it("seeds the approved taxonomy idempotently without inventing links", async () => {
    const seed = await readFile(new URL("../../scripts/seed-service-needs.ts", import.meta.url), "utf8");
    for (const code of expectedCodes) expect(seed).toContain(`"${code}"`);
    expect(seed).toContain("ON CONFLICT (code) DO NOTHING");
    expect(seed).not.toMatch(/INSERT INTO service_need_links/i);
  });

  it("serializes case-insensitive title duplicate checks in administrative writes", async () => {
    const repository = await readFile(new URL("../../src/modules/service-needs/service-needs.repository.ts", import.meta.url), "utf8");
    expect(repository).toContain("pg_advisory_xact_lock(hashtext('ilvox:service-needs:title-uniqueness'))");
    expect(repository).toContain("lower(btrim(title)) = lower(btrim($1))");
    expect(repository).toContain("id <> $1 AND lower(btrim(title)) = lower(btrim($2))");
  });

  it("tracks migration 0010 and a focused smoke with deterministic cleanup", async () => {
    const [migration, journal, smoke] = await Promise.all([
      readFile(new URL("../../drizzle/migrations/0010_phase8b-service-needs.sql", import.meta.url), "utf8"),
      readFile(new URL("../../drizzle/migrations/meta/_journal.json", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/smoke-phase8b-service-needs.ts", import.meta.url), "utf8"),
    ]);
    expect(migration).toContain('CONSTRAINT "service_needs_code_key" UNIQUE("code")');
    expect(migration.match(/ON DELETE restrict/g)).toHaveLength(2);
    expect(journal).toContain('"tag": "0010_phase8b-service-needs"');
    expect(smoke).toContain("PHASE8B_SMOKE_");
    expect(smoke).toContain("sharedServiceNeeds: 2");
    expect(smoke).toContain("residualFixtures");
  });
});
