import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { internalUserInvitations } from "../../src/db/schema/invitations.js";

describe("Phase 8D.2 persistence artifacts", () => {
  it("preserves invitation history with explicit lifecycle, restricted FKs and pending uniqueness", () => {
    const table = getTableConfig(internalUserInvitations);
    expect(table.foreignKeys).toHaveLength(3);
    expect(table.foreignKeys.every((foreignKey) => foreignKey.onDelete === "restrict")).toBe(true);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "chk_internal_user_invitations_email_normalized",
      "chk_internal_user_invitations_status",
      "chk_internal_user_invitations_lifecycle",
      "chk_internal_user_invitations_expiration",
    ]));
    expect(table.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      "uq_internal_user_invitations_pending_email",
      "uq_internal_user_invitations_clerk_id",
      "idx_internal_user_invitations_email",
      "idx_internal_user_invitations_status",
    ]));
  });

  it("tracks migration 0012, rollback and the focused smoke", async () => {
    const [migration, journal, rollback, smoke] = await Promise.all([
      readFile(new URL("../../drizzle/migrations/0012_phase8d2-internal-invitations.sql", import.meta.url), "utf8"),
      readFile(new URL("../../drizzle/migrations/meta/_journal.json", import.meta.url), "utf8"),
      readFile(new URL("../../drizzle/rollbacks/0012_phase8d2-internal-invitations.down.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/smoke-phase8d2-internal-invitations.ts", import.meta.url), "utf8"),
    ]);
    expect(migration).toContain('CREATE TABLE "internal_user_invitations"');
    expect(migration).toContain('ON DELETE restrict');
    expect(journal).toContain('"tag": "0012_phase8d2-internal-invitations"');
    expect(rollback).toContain("DROP TABLE IF EXISTS internal_user_invitations");
    expect(smoke).toContain("PHASE8D2_SMOKE_");
    expect(smoke).toContain("residualFixtures");
  });
});
