import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import {
  bootstrapOwnerByClerkUserId,
  parseOwnerEmail,
  resolveExactClerkUser,
} from "../../scripts/bootstrap-owner.js";

describe("owner bootstrap", () => {
  it("requires an explicit email argument", () => {
    expect(parseOwnerEmail(["--email", " Owner@Example.com "])).toBe("owner@example.com");
    expect(() => parseOwnerEmail([])).toThrow("Uso:");
  });

  it("requires exactly one exact Clerk identity", () => {
    const exact = {
      id: "user_exact",
      emailAddresses: [{ emailAddress: "owner@example.com" }],
    };
    const partial = {
      id: "user_partial",
      emailAddresses: [{ emailAddress: "owner@example.com.invalid" }],
    };

    expect(resolveExactClerkUser("OWNER@example.com", [exact, partial]).id).toBe("user_exact");
    expect(() => resolveExactClerkUser("missing@example.com", [exact])).toThrow(
      "OWNER_CLERK_IDENTITY_COUNT_INVALID",
    );
    expect(() => resolveExactClerkUser("owner@example.com", [exact, exact])).toThrow(
      "OWNER_CLERK_IDENTITY_COUNT_INVALID",
    );
  });

  it("activates and assigns once, then repeats without additional effects", async () => {
    const state = {
      status: "pending",
      roleAssigned: false,
      audits: 0,
      commits: 0,
      rollbacks: 0,
    };
    const query = async (queryText: unknown): Promise<unknown> => {
      await Promise.resolve();
      const sql = String(queryText);
      if (sql === "BEGIN" || sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("FROM app_users")) {
        return { rowCount: 1, rows: [{ id: "local-owner", status: state.status }] };
      }
      if (sql.includes("FROM roles")) {
        return { rowCount: 1, rows: [{ id: "super-admin-role" }] };
      }
      if (sql.includes("FROM permissions")) {
        return { rowCount: 1, rows: [{ total: 39, assigned: 39 }] };
      }
      if (sql.includes("UPDATE app_users")) {
        state.status = "active";
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO user_roles")) {
        const rowCount = state.roleAssigned ? 0 : 1;
        state.roleAssigned = true;
        return { rowCount, rows: [] };
      }
      if (sql.includes("INSERT INTO audit_events")) {
        state.audits += 1;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("count(DISTINCT p.id)")) {
        return { rowCount: 1, rows: [{ total: state.roleAssigned ? 39 : 0 }] };
      }
      if (sql === "COMMIT") {
        state.commits += 1;
        return { rowCount: 0, rows: [] };
      }
      if (sql === "ROLLBACK") {
        state.rollbacks += 1;
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };
    const client = { query } as unknown as PoolClient;

    const first = await bootstrapOwnerByClerkUserId(client, "user_owner");
    const second = await bootstrapOwnerByClerkUserId(client, "user_owner");

    expect(first).toMatchObject({
      changed: true,
      status: "active",
      role: "super_admin",
      scope: "global",
      permissionCount: 39,
    });
    expect(second.changed).toBe(false);
    expect(state).toEqual({
      status: "active",
      roleAssigned: true,
      audits: 1,
      commits: 2,
      rollbacks: 0,
    });
  });

  it("never creates a missing local profile", async () => {
    const statements: string[] = [];
    const query = async (queryText: unknown): Promise<unknown> => {
      await Promise.resolve();
      const sql = String(queryText);
      statements.push(sql);
      if (sql.includes("FROM app_users")) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    };

    await expect(
      bootstrapOwnerByClerkUserId({ query } as unknown as PoolClient, "user_not_synced"),
    ).rejects.toThrow("OWNER_LOCAL_PROFILE_NOT_SYNCHRONIZED");
    expect(statements.some((sql) => sql.includes("INSERT INTO app_users"))).toBe(false);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});
