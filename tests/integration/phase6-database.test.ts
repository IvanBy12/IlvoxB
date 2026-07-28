import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTicketRepository } from "../../src/modules/tickets/ticket.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ADMIN = "63000000-0000-4000-8000-000000000001";
const REQUESTER = "63000000-0000-4000-8000-000000000002";
const OTHER = "63000000-0000-4000-8000-000000000003";
const SUPPORT = "63000000-0000-4000-8000-000000000004";
const REVOKED = "63000000-0000-4000-8000-000000000005";
const ORG_A = "63000000-0000-4000-8000-000000000101";
const ORG_B = "63000000-0000-4000-8000-000000000102";
const PROJECT_A = "63000000-0000-4000-8000-000000000201";
const PROJECT_B = "63000000-0000-4000-8000-000000000202";

describe.skipIf(testDatabaseUrl === undefined)("Phase 6 ticket PostgreSQL behavior", () => {
  const schema = `ilvox_phase6_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const globalScope = { kind: "global" as const, actorId: ADMIN, crossOrganization: true as const };
  const requesterOwn = { kind: "own" as const, actorId: REQUESTER, organizationIds: [] };
  const otherOwn = { kind: "own" as const, actorId: OTHER, organizationIds: [] };
  const organizationA = { kind: "organization" as const, actorId: REQUESTER, organizationIds: [ORG_A] };
  const assignedProject = { kind: "assigned" as const, actorId: REQUESTER, organizationIds: [ORG_A] };
  const revokedOrganization = { kind: "organization" as const, actorId: REVOKED, organizationIds: [ORG_A] };
  const audit = (actorUserId = ADMIN) => ({ actorUserId, requestId: randomUUID() });
  const listInput = {
    page: 1,
    pageSize: 100,
    sortBy: "createdAt" as const,
    sortDirection: "asc" as const,
  };
  let admin: pg.Client;
  let pool: Pool;
  let tickets: PostgresTicketRepository;

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
      "0006_phase5-member-revocation.sql",
      "0007_phase5-deliverable-milestone.sql",
      "0008_phase6-tickets.sql",
    ]) {
      await admin.query(readFileSync(resolve("drizzle", "migrations", migration), "utf8")
        .replaceAll("--> statement-breakpoint", ""));
    }
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 12,
      options: `-c search_path=${schema},public`,
    });
    tickets = new PostgresTicketRepository(pool);
    await pool.query(
      `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
       ($1,'phase6_admin','phase6-admin@example.test','active'),
       ($2,'phase6_requester','phase6-requester@example.test','active'),
       ($3,'phase6_other','phase6-other@example.test','active'),
       ($4,'phase6_support','phase6-support@example.test','active'),
       ($5,'phase6_revoked','phase6-revoked@example.test','active')`,
      [ADMIN, REQUESTER, OTHER, SUPPORT, REVOKED],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id,role_scope)
       SELECT users.id,r.id,'global'
       FROM (VALUES ($1::uuid,'admin'),($2::uuid,'support_agent')) users(id,role_code)
       JOIN roles r ON r.scope='global' AND r.code=users.role_code`,
      [ADMIN, SUPPORT],
    );
    await pool.query(
      `INSERT INTO organizations (id,name,status) VALUES
       ($1,'Phase 6 A','active'),($2,'Phase 6 B','active')`,
      [ORG_A, ORG_B],
    );
    await pool.query(
      `INSERT INTO organization_memberships (
         organization_id,user_id,role_id,role_scope,status,activated_at,revoked_at
       )
       SELECT context.organization_id,context.user_id,r.id,'organization',
              context.status,CASE WHEN context.status='active' THEN now() END,
              CASE WHEN context.status='revoked' THEN now() END
       FROM (VALUES
         ($1::uuid,$2::uuid,'active'),
         ($1::uuid,$3::uuid,'revoked')
       ) context(organization_id,user_id,status)
       JOIN roles r ON r.scope='organization' AND r.code='client_contact'`,
      [ORG_A, REQUESTER, REVOKED],
    );
    await pool.query(
      `INSERT INTO projects (
         id,organization_id,name,description,status,priority,lead_user_id,
         start_date,due_date,created_by_user_id
       ) VALUES
       ($1,$2,'Phase 6 A','A','planning','medium',$3,'2026-07-01','2026-09-30',$3),
       ($4,$5,'Phase 6 B','B','planning','medium',$3,'2026-07-01','2026-09-30',$3)`,
      [PROJECT_A, ORG_A, ADMIN, PROJECT_B, ORG_B],
    );
    await pool.query(
      `INSERT INTO project_members (
         project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
       )
       SELECT $1,$2,$3,id,'project',$4
       FROM roles WHERE scope='project' AND code='project_member'`,
      [PROJECT_A, ORG_A, REQUESTER, ADMIN],
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

  it("creates private standalone, organizational and project tickets with generated unique codes", async () => {
    const standalone = await tickets.create(requesterOwn, {
      type: "incident",
      subject: "Standalone requester ticket",
      description: "Private",
    }, REQUESTER, audit(REQUESTER));
    expect(standalone).toMatchObject({
      organizationId: null,
      projectId: null,
      requesterUserId: REQUESTER,
      status: "new",
    });
    const organizational = await tickets.create(organizationA, {
      organizationId: ORG_A,
      type: "question",
      subject: "Organization ticket",
      description: "Organization",
    }, REQUESTER, audit(REQUESTER));
    expect(organizational).toMatchObject({ organizationId: ORG_A, projectId: null });
    const project = await tickets.create(assignedProject, {
      projectId: PROJECT_A,
      type: "bug",
      subject: "Project ticket",
      description: "Project",
    }, REQUESTER, audit(REQUESTER));
    expect(project).toMatchObject({ organizationId: ORG_A, projectId: PROJECT_A });
    const records = [standalone, organizational, project].filter((item) => typeof item === "object");
    expect(new Set(records.map((item) => item.code)).size).toBe(3);
    expect(await tickets.create(assignedProject, {
      organizationId: ORG_B,
      projectId: PROJECT_A,
      type: "bug",
      subject: "Cross tenant",
      description: "Rejected",
    }, REQUESTER, audit(REQUESTER))).toBe("invalid_context");
  });

  it("isolates standalone own scope and uses the same scope for count and rows", async () => {
    await tickets.create(otherOwn, {
      type: "question",
      subject: "Other private ticket",
      description: "Other",
    }, OTHER, audit(OTHER));
    const own = await tickets.listAuthorized(requesterOwn, {
      ...listInput,
      search: "Standalone requester",
      status: "new",
      priority: "medium",
    });
    expect(own.pagination.total).toBe(1);
    expect(own.items).toHaveLength(1);
    expect(own.items[0]?.requesterUserId).toBe(REQUESTER);
    expect((await tickets.listAuthorized(otherOwn, {
      ...listInput,
      search: "Standalone requester",
    })).pagination.total).toBe(0);
  });

  it("removes organization and project access immediately after revocation", async () => {
    expect((await tickets.listAuthorized(revokedOrganization, listInput)).pagination.total).toBe(0);
    await tickets.create(globalScope, {
      projectId: PROJECT_A,
      type: "incident",
      subject: "Membership-only project ticket",
      description: "Visible through active project membership",
    }, ADMIN, audit());
    expect((await tickets.listAuthorized(assignedProject, {
      ...listInput,
      search: "Membership-only",
    })).pagination.total).toBeGreaterThan(0);
    await pool.query(
      `UPDATE project_members SET status='revoked',revoked_at=now(),revoked_by_user_id=$1
       WHERE project_id=$2 AND user_id=$3`,
      [ADMIN, PROJECT_A, REQUESTER],
    );
    expect((await tickets.listAuthorized(assignedProject, {
      ...listInput,
      search: "Membership-only",
    })).pagination.total).toBe(0);
  });

  it("serializes concurrent assignments and rejects stale optimistic timestamps", async () => {
    const created = await tickets.create(globalScope, {
      type: "incident",
      subject: "Concurrent assignment",
      description: "Concurrency",
    }, REQUESTER, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const results = await Promise.all([
      tickets.assign(globalScope, created.id, SUPPORT, created.updatedAt, audit()),
      tickets.assign(globalScope, created.id, ADMIN, created.updatedAt, audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
    expect(await tickets.changePriority(
      globalScope,
      created.id,
      "urgent",
      created.updatedAt,
      audit(),
    )).toBe("conflict");
  });

  it("serializes transitions and preserves resolution/closure invariants", async () => {
    const created = await tickets.create(globalScope, {
      type: "incident",
      subject: "Concurrent transition",
      description: "Concurrency",
    }, REQUESTER, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const results = await Promise.all([
      tickets.transition(globalScope, created.id, "new", "classifying", undefined, undefined, created.updatedAt, audit()),
      tickets.transition(globalScope, created.id, "new", "cancelled", undefined, "Duplicate", created.updatedAt, audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
  });

  it("derives comment organization, filters internal visibility and omits content from audit", async () => {
    const created = await tickets.create(globalScope, {
      type: "question",
      subject: "Comment ticket",
      description: "Comments",
    }, REQUESTER, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const client = await tickets.createComment(
      requesterOwn,
      created.id,
      REQUESTER,
      "client",
      "Client details",
      audit(REQUESTER),
    );
    const internal = await tickets.createComment(
      globalScope,
      created.id,
      SUPPORT,
      "internal",
      "Internal details",
      audit(SUPPORT),
    );
    expect(client).toMatchObject({ organizationId: null, authorUserId: REQUESTER });
    expect(internal).toMatchObject({ organizationId: null, authorUserId: SUPPORT });
    expect((await tickets.listComments(requesterOwn, created.id, false))?.map((item) => item.visibility))
      .toEqual(["client"]);
    expect((await tickets.listComments(globalScope, created.id, true))?.map((item) => item.visibility))
      .toEqual(["client", "internal"]);
    const auditRows = await pool.query<{ readonly new_values: Record<string, unknown> }>(
      `SELECT new_values FROM audit_events
       WHERE action='ticket_comment.created' AND entity_id IN ($1,$2)`,
      [
        typeof client === "object" ? client.id : null,
        typeof internal === "object" ? internal.id : null,
      ],
    );
    expect(auditRows.rows.every((row) => !("content" in row.new_values))).toBe(true);
  });

  it("enforces project and comment parent integrity directly in PostgreSQL", async () => {
    await expect(pool.query(
      `INSERT INTO tickets (
         organization_id,project_id,requester_user_id,type,subject,description
       ) VALUES (NULL,$1,$2,'bug','Invalid project','Invalid')`,
      [PROJECT_B, REQUESTER],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `INSERT INTO ticket_comments (
         ticket_id,author_user_id,visibility,content
       ) VALUES ($1,$2,'client','Orphan')`,
      ["63000000-0000-4000-8000-000000000999", REQUESTER],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("generates collision-free ticket codes under concurrent creation", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      tickets.create(globalScope, {
        type: "service_request",
        subject: `Concurrent code ${index}`,
        description: "Identity generation",
      }, REQUESTER, audit())));
    expect(results.every((result) => typeof result === "object")).toBe(true);
    const codes = results.filter((result) => typeof result === "object").map((result) => result.code);
    expect(new Set(codes).size).toBe(12);
  });
});
