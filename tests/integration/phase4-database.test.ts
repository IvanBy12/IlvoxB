import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresLeadRepository } from "../../src/modules/leads/lead.repository.js";
import { PostgresOrganizationRepository } from "../../src/modules/organizations/organization.repository.js";
import { PostgresServiceCatalogRepository } from "../../src/modules/services/service-catalog.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const USER_INTERNAL = "10000000-0000-4000-8000-000000000001";
const USER_CLIENT = "10000000-0000-4000-8000-000000000002";
const SERVICE_PUBLIC = "10000000-0000-4000-8000-000000000101";
const SERVICE_INACTIVE = "10000000-0000-4000-8000-000000000102";
const LEAD_APPROVED = "10000000-0000-4000-8000-000000000201";
const LEAD_STANDALONE = "10000000-0000-4000-8000-000000000202";
const LEAD_REUSE = "10000000-0000-4000-8000-000000000203";
const LEAD_ROLLBACK = "10000000-0000-4000-8000-000000000204";
const ORG_A = "10000000-0000-4000-8000-000000000301";
const ORG_B = "10000000-0000-4000-8000-000000000302";

describe.skipIf(testDatabaseUrl === undefined)("Phase 4 PostgreSQL behavior", () => {
  const schema = `ilvox_phase4_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const globalScope = { kind: "global" as const, actorId: USER_INTERNAL, crossOrganization: true as const };
  const audit = () => ({ actorUserId: USER_INTERNAL, requestId: randomUUID() });
  let admin: pg.Client;
  let pool: Pool;
  let services: PostgresServiceCatalogRepository;
  let leads: PostgresLeadRepository;
  let organizations: PostgresOrganizationRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quote(schema)}`);
    await admin.query(`SET search_path TO ${quote(schema)}, public`);
    await admin.query(readFileSync(
      resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"),
      "utf8",
    ));
    for (const migration of [
      "0001_phase3-rbac-separation.sql",
      "0002_phase3-file-audience.sql",
      "0003_phase3-clerk-event-idempotency.sql",
      "0004_phase4-5-lead-standalone-conversion.sql",
      "0005_phase4-5-services-manage.sql",
    ]) {
      await admin.query(readFileSync(resolve("drizzle", "migrations", migration), "utf8")
        .replaceAll("--> statement-breakpoint", ""));
    }
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 4,
      options: `-c search_path=${schema},public`,
    });
    services = new PostgresServiceCatalogRepository(pool);
    leads = new PostgresLeadRepository(pool);
    organizations = new PostgresOrganizationRepository(pool);

    await pool.query(
      `INSERT INTO app_users (id, clerk_user_id, primary_email, status) VALUES
       ($1, 'phase4_internal', 'internal@example.test', 'active'),
       ($2, 'phase4_client', 'client@example.test', 'active')`,
      [USER_INTERNAL, USER_CLIENT],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, role_scope)
       SELECT $1, id, 'global' FROM roles WHERE scope = 'global' AND code = 'admin'`,
      [USER_INTERNAL],
    );
    await pool.query(
      `INSERT INTO services (id, name, category, description, is_public, is_active) VALUES
       ($1, 'Public service', 'development', 'Visible service', true, true),
       ($2, 'Inactive service', 'support', 'Hidden service', true, false)`,
      [SERVICE_PUBLIC, SERVICE_INACTIVE],
    );
    await pool.query(
      `INSERT INTO leads (
         id, full_name, email, message, source, status, assigned_to_user_id
       ) VALUES
         ($1, 'Approved person', 'approved@example.test', 'Approved request',
          'contact', 'approved', $2),
         ($3, 'Standalone person', 'standalone@example.test', 'Standalone request',
          'contact', 'approved', $2),
         ($4, 'Reuse person', 'reuse@example.test', 'Reuse request',
          'contact', 'approved', $2),
         ($5, 'Rollback person', 'rollback@example.test', 'Rollback request',
          'contact', 'approved', $2)`,
      [LEAD_APPROVED, USER_INTERNAL, LEAD_STANDALONE, LEAD_REUSE, LEAD_ROLLBACK],
    );
    await pool.query(
      `INSERT INTO organizations (id, name, status) VALUES
       ($1, 'Scoped A', 'active'), ($2, 'Scoped B', 'active')`,
      [ORG_A, ORG_B],
    );
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query("RESET search_path").catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      await admin.end();
    }
  });

  it("filters the public catalog by both visibility and active status", async () => {
    const result = await services.listPublic({ page: 1, pageSize: 20 });
    expect(result.items.map((service) => service.id)).toEqual([SERVICE_PUBLIC]);
    expect(await services.findPublicById(SERVICE_INACTIVE)).toBeNull();
  });

  it("creates repeated legitimate public leads without deduplicating by email", async () => {
    const input = {
      fullName: "Repeated person",
      email: "repeat@example.test",
      serviceId: SERVICE_PUBLIC,
      message: "First or second legitimate request",
      source: "contact" as const,
    };
    const first = await leads.createPublic(input, { requestId: randomUUID() });
    const second = await leads.createPublic(input, { requestId: randomUUID() });
    expect(first.id).not.toBe(second.id);
    expect([first.status, second.status]).toEqual(["new", "new"]);
    expect(first.assignedToUserId).toBeNull();
  });

  it("serializes concurrent conversion and returns one organization idempotently", async () => {
    const input = {
      mode: "create_organization" as const,
      name: "Converted organization",
      countryCode: "CO",
      taxId: "900.123.456-7",
    };
    const results = await Promise.all([
      leads.convert(globalScope, globalScope, LEAD_APPROVED, input, audit()),
      leads.convert(globalScope, globalScope, LEAD_APPROVED, input, audit()),
    ]);
    expect(results.every((result) => typeof result === "object" && result !== null)).toBe(true);
    const conversions = results as Exclude<(typeof results)[number], string | null>[];
    expect(new Set(conversions.map((result) => result.organizationId)).size).toBe(1);
    expect(conversions.map((result) => result.idempotent).sort()).toEqual([false, true]);
    expect(conversions.every((result) => result.primaryContactCreated === false)).toBe(true);
    expect(conversions.every((result) => result.mode === "create_organization")).toBe(true);
    expect(conversions.every((result) => result.organizationCreated === true)).toBe(true);
    expect((await pool.query<{ readonly total: number }>(
      "SELECT count(*)::int AS total FROM organizations WHERE tax_id_normalized = '9001234567'",
    )).rows[0]?.total).toBe(1);
  });

  it("rolls back organization conversion when transactional audit fails", async () => {
    await expect(leads.convert(
      globalScope,
      globalScope,
      LEAD_ROLLBACK,
      {
        mode: "create_organization",
        name: "Organization that must roll back",
      },
      { actorUserId: USER_INTERNAL, requestId: "not-a-uuid" },
    )).rejects.toMatchObject({ code: "22P02" });

    expect((await pool.query<{ readonly total: number }>(
      "SELECT count(*)::int AS total FROM organizations WHERE name = 'Organization that must roll back'",
    )).rows[0]?.total).toBe(0);
    expect((await pool.query<{
      readonly status: string;
      readonly converted_organization_id: string | null;
      readonly converted_at: Date | null;
    }>(
      `SELECT status, converted_organization_id, converted_at
       FROM leads WHERE id = $1`,
      [LEAD_ROLLBACK],
    )).rows[0]).toEqual({
      status: "approved",
      converted_organization_id: null,
      converted_at: null,
    });
  });

  it("converts standalone concurrently without creating organization, membership, or identity", async () => {
    const before = await pool.query<{
      readonly organizations: number;
      readonly memberships: number;
      readonly users: number;
    }>(`SELECT
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM organization_memberships) AS memberships,
      (SELECT count(*)::int FROM app_users) AS users`);
    const results = await Promise.all([
      leads.convert(globalScope, undefined, LEAD_STANDALONE, { mode: "standalone" }, audit()),
      leads.convert(globalScope, undefined, LEAD_STANDALONE, { mode: "standalone" }, audit()),
    ]);
    const conversions = results as Exclude<(typeof results)[number], string | null>[];
    expect(conversions.map((result) => result.idempotent).sort()).toEqual([false, true]);
    expect(conversions.every((result) =>
      result.mode === "standalone" &&
      result.organizationId === null &&
      result.organizationCreated === false &&
      result.primaryContactCreated === false)).toBe(true);

    const lead = await pool.query<{
      readonly status: string;
      readonly converted_organization_id: string | null;
      readonly converted_at: Date | null;
    }>(
      "SELECT status, converted_organization_id, converted_at FROM leads WHERE id = $1",
      [LEAD_STANDALONE],
    );
    expect(lead.rows[0]).toMatchObject({
      status: "converted",
      converted_organization_id: null,
    });
    expect(lead.rows[0]?.converted_at).toBeInstanceOf(Date);

    const after = await pool.query<{
      readonly organizations: number;
      readonly memberships: number;
      readonly users: number;
    }>(`SELECT
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM organization_memberships) AS memberships,
      (SELECT count(*)::int FROM app_users) AS users`);
    expect(after.rows[0]).toEqual(before.rows[0]);

    expect(await leads.convert(
      globalScope,
      globalScope,
      LEAD_STANDALONE,
      { mode: "create_organization", name: "Incompatible retry" },
      audit(),
    )).toBe("organization_conflict");
    const event = await pool.query<{ readonly mode: string }>(
      `SELECT new_values ->> 'mode' AS mode
       FROM audit_events
       WHERE action = 'lead.converted' AND entity_id = $1`,
      [LEAD_STANDALONE],
    );
    expect(event.rows).toEqual([{ mode: "standalone" }]);
  });

  it("reuses an explicit organization and preserves modality on retry", async () => {
    const first = await leads.convert(
      globalScope,
      globalScope,
      LEAD_REUSE,
      { mode: "reuse_organization", organizationId: ORG_A },
      audit(),
    );
    const second = await leads.convert(
      globalScope,
      globalScope,
      LEAD_REUSE,
      { mode: "reuse_organization", organizationId: ORG_A },
      audit(),
    );
    expect(first).toMatchObject({
      mode: "reuse_organization",
      organizationCreated: false,
      organizationId: ORG_A,
      idempotent: false,
    });
    expect(second).toMatchObject({
      mode: "reuse_organization",
      organizationCreated: false,
      organizationId: ORG_A,
      idempotent: true,
    });
  });

  it("keeps standalone leads private to global or assigned internal scopes", async () => {
    const assigned = {
      kind: "assigned" as const,
      actorId: USER_INTERNAL,
      organizationIds: [] as readonly string[],
    };
    const organization = {
      kind: "organization" as const,
      actorId: USER_CLIENT,
      organizationIds: [ORG_A],
    };
    expect((await leads.findAuthorized(assigned, LEAD_STANDALONE))?.id).toBe(LEAD_STANDALONE);
    expect(await leads.findAuthorized(organization, LEAD_STANDALONE)).toBeNull();
  });

  it("creates, hides, and deactivates services with transactional audit", async () => {
    const created = await services.createAuthorized(globalScope, {
      name: "Managed service",
      category: "automation",
      description: "Managed from the administrative API",
      isPublic: true,
      isActive: true,
    }, audit());
    expect(created).not.toBe("duplicate");
    if (created === "duplicate") return;
    expect((await services.findPublicById(created.id))?.id).toBe(created.id);
    const hidden = await services.updateAuthorized(
      globalScope,
      created.id,
      { isPublic: false },
      audit(),
    );
    expect(hidden).toMatchObject({ isPublic: false, isActive: true });
    expect(await services.findPublicById(created.id)).toBeNull();
    expect((await services.findAuthorizedById(globalScope, created.id))?.id).toBe(created.id);
    const inactive = await services.updateAuthorized(
      globalScope,
      created.id,
      { isPublic: true, isActive: false },
      audit(),
    );
    expect(inactive).toMatchObject({ isPublic: true, isActive: false });
    expect(await services.findPublicById(created.id)).toBeNull();
    expect(await services.createAuthorized(globalScope, {
      name: "Managed service",
      category: "support",
      description: "Duplicate",
      isPublic: true,
      isActive: true,
    }, audit())).toBe("duplicate");
    const events = await pool.query<{ readonly action: string }>(
      `SELECT action FROM audit_events
       WHERE entity_type = 'service' AND entity_id = $1
       ORDER BY created_at, id`,
      [created.id],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      "service.created",
      "service.updated",
      "service.updated",
    ]);
  });

  it("grants services.manage only to super_admin and admin", async () => {
    const result = await pool.query<{ readonly scope: string; readonly code: string }>(
      `SELECT r.scope, r.code
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'services.manage'
       ORDER BY r.code`,
    );
    expect(result.rows).toEqual([
      { scope: "global", code: "admin" },
      { scope: "global", code: "super_admin" },
    ]);
  });

  it("applies organization scope to lists, detail and counts", async () => {
    const scopeA = { kind: "organization" as const, actorId: USER_CLIENT, organizationIds: [ORG_A] };
    const list = await organizations.listAuthorized(scopeA, { page: 1, pageSize: 20 });
    expect(list.pagination.total).toBe(1);
    expect(list.items.map((organization) => organization.id)).toEqual([ORG_A]);
    expect(await organizations.findAuthorized(scopeA, ORG_B)).toBeNull();
  });

  it("creates and revokes a local membership without deleting identity history", async () => {
    const created = await organizations.createMember(
      globalScope,
      ORG_A,
      { userId: USER_CLIENT, roleCode: "client_contact", status: "active" },
      { ...audit(), organizationId: ORG_A },
    );
    expect(created).toMatchObject({ userId: USER_CLIENT, roleCode: "client_contact", status: "active" });
    const revoked = await organizations.updateMember(
      globalScope,
      ORG_A,
      USER_CLIENT,
      { status: "revoked" },
      { ...audit(), organizationId: ORG_A },
    );
    expect(revoked).toMatchObject({ userId: USER_CLIENT, status: "revoked" });
    expect((await pool.query<{ readonly status: string }>(
      "SELECT status FROM app_users WHERE id = $1",
      [USER_CLIENT],
    )).rows[0]?.status)
      .toBe("active");
  });

  it("records only redacted audit metadata for public lead creation", async () => {
    const events = await pool.query<{
      readonly old_values: Record<string, unknown> | null;
      readonly new_values: Record<string, unknown> | null;
    }>(
      "SELECT old_values, new_values FROM audit_events WHERE action = 'lead.public_created'",
    );
    expect(events.rowCount).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(events.rows)).not.toMatch(/repeat@example|First or second/);
  });
});
