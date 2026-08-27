import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "../../src/modules/identity/identity.repository.js";
import { PostgresProjectRepository } from "../../src/modules/projects/project.repository.js";
import { PostgresTaskRepository } from "../../src/modules/tasks/task.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const USER_ADMIN = "30000000-0000-4000-8000-000000000001";
const USER_MEMBER = "30000000-0000-4000-8000-000000000002";
const USER_INTERNAL = "30000000-0000-4000-8000-000000000003";
const USER_INACTIVE = "30000000-0000-4000-8000-000000000004";
const USER_OUTSIDE = "30000000-0000-4000-8000-000000000005";
const USER_CONCURRENT = "30000000-0000-4000-8000-000000000006";
const USER_REVOKED = "30000000-0000-4000-8000-000000000007";
const ORG_A = "30000000-0000-4000-8000-000000000101";
const ORG_B = "30000000-0000-4000-8000-000000000102";
const PROJECT_A = "30000000-0000-4000-8000-000000000201";
const PROJECT_B = "30000000-0000-4000-8000-000000000202";

describe.skipIf(testDatabaseUrl === undefined)("Phase 5 closure PostgreSQL behavior", () => {
  const schema = `ilvox_phase5_closure_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const globalScope = { kind: "global" as const, actorId: USER_ADMIN, crossOrganization: true as const };
  const organizationA = { kind: "organization" as const, actorId: USER_MEMBER, organizationIds: [ORG_A] };
  const organizationB = { kind: "organization" as const, actorId: USER_MEMBER, organizationIds: [ORG_B] };
  const assignedA = { kind: "assigned" as const, actorId: USER_MEMBER, organizationIds: [ORG_A] };
  const ownA = { kind: "own" as const, actorId: USER_ADMIN, organizationIds: [ORG_A] };
  const audit = () => ({ actorUserId: USER_ADMIN, requestId: randomUUID() });
  let admin: pg.Client;
  let pool: Pool;
  let projects: PostgresProjectRepository;
  let tasks: PostgresTaskRepository;
  let identity: PostgresIdentityRepository;

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
    ]) {
      await admin.query(readFileSync(resolve("drizzle", "migrations", migration), "utf8")
        .replaceAll("--> statement-breakpoint", ""));
    }
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 8,
      options: `-c search_path=${schema},public`,
    });
    projects = new PostgresProjectRepository(pool);
    tasks = new PostgresTaskRepository(pool);
    identity = new PostgresIdentityRepository(pool);

    await pool.query(
      `INSERT INTO app_users (id, clerk_user_id, primary_email, status) VALUES
       ($1,'closure_admin','closure-admin@example.test','active'),
       ($2,'closure_member','closure-member@example.test','active'),
       ($3,'closure_internal','closure-internal@example.test','active'),
       ($4,'closure_inactive','closure-inactive@example.test','blocked'),
       ($5,'closure_outside','closure-outside@example.test','active'),
       ($6,'closure_concurrent','closure-concurrent@example.test','active'),
       ($7,'closure_revoked','closure-revoked@example.test','active')`,
      [
        USER_ADMIN,
        USER_MEMBER,
        USER_INTERNAL,
        USER_INACTIVE,
        USER_OUTSIDE,
        USER_CONCURRENT,
        USER_REVOKED,
      ],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, role_scope)
       SELECT users.user_id, r.id, 'global'
       FROM (VALUES ($1::uuid),($2::uuid),($3::uuid)) users(user_id)
       CROSS JOIN roles r
       WHERE r.scope='global' AND r.code =
         CASE WHEN users.user_id=$1 THEN 'admin' ELSE 'contributor' END`,
      [USER_ADMIN, USER_INTERNAL, USER_CONCURRENT],
    );
    await pool.query(
      `INSERT INTO organizations (id,name,status) VALUES
       ($1,'Closure A','active'),($2,'Closure B','active')`,
      [ORG_A, ORG_B],
    );
    await pool.query(
      `INSERT INTO organization_memberships (
         organization_id,user_id,role_id,role_scope,status,activated_at
       )
       SELECT $1, users.user_id, r.id, 'organization', 'active', now()
       FROM (VALUES ($2::uuid),($3::uuid)) users(user_id)
       CROSS JOIN roles r
       WHERE r.scope='organization' AND r.code='client_manager'`,
      [ORG_A, USER_MEMBER, USER_REVOKED],
    );
    await pool.query(
      `INSERT INTO projects (
         id,organization_id,name,description,status,priority,lead_user_id,
         start_date,due_date,created_by_user_id
       ) VALUES
       ($1,$2,'Closure Project A','A','planning','medium',$3,'2026-07-01','2026-09-30',$3),
       ($4,$5,'Closure Project B','B','planning','medium',$3,'2026-07-01','2026-09-30',$3)`,
      [PROJECT_A, ORG_A, USER_ADMIN, PROJECT_B, ORG_B],
    );
    await pool.query(
      `INSERT INTO project_members (
         project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
       )
       SELECT $1,$2,$3,id,'project',$4
       FROM roles WHERE scope='project' AND code='project_member'`,
      [PROJECT_A, ORG_A, USER_MEMBER, USER_ADMIN],
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

  it("lists active members only and applies A/B project scopes", async () => {
    expect((await projects.listMembers(assignedA, PROJECT_A))?.map((item) => item.userId))
      .toEqual([USER_MEMBER]);
    expect(await projects.listMembers(organizationB, PROJECT_A)).toBeNull();
    expect((await projects.findAuthorized(organizationA, PROJECT_A))?.id).toBe(PROJECT_A);
    expect(await projects.findAuthorized(organizationA, PROJECT_B)).toBeNull();
  });

  it("adds and updates an eligible member while rejecting inactive and out-of-context users", async () => {
    const created = await projects.createMember(
      globalScope,
      PROJECT_A,
      USER_INTERNAL,
      "project_member",
      audit(),
    );
    expect(created).toMatchObject({ userId: USER_INTERNAL, status: "active" });
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const updated = await projects.updateMember(
      globalScope,
      PROJECT_A,
      USER_INTERNAL,
      "project_lead",
      created.updatedAt,
      audit(),
    );
    expect(updated).toMatchObject({ roleCode: "project_lead", status: "active" });
    expect(await projects.updateMember(
      globalScope,
      PROJECT_A,
      USER_INTERNAL,
      "project_viewer",
      created.updatedAt,
      audit(),
    )).toBe("conflict");
    expect(await projects.createMember(
      globalScope,
      PROJECT_A,
      USER_INACTIVE,
      "project_member",
      audit(),
    )).toBe("ineligible_user");
    expect(await projects.createMember(
      globalScope,
      PROJECT_A,
      USER_OUTSIDE,
      "project_member",
      audit(),
    )).toBe("ineligible_user");
  });

  it("detects concurrent member role changes with one winner", async () => {
    const created = await projects.createMember(
      globalScope,
      PROJECT_A,
      USER_CONCURRENT,
      "project_member",
      audit(),
    );
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const results = await Promise.all([
      projects.updateMember(
        globalScope,
        PROJECT_A,
        USER_CONCURRENT,
        "project_lead",
        created.updatedAt,
        audit(),
      ),
      projects.updateMember(
        globalScope,
        PROJECT_A,
        USER_CONCURRENT,
        "project_viewer",
        created.updatedAt,
        audit(),
      ),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
  });

  it("supports milestone list/detail/create/update/state/scope and concurrency", async () => {
    const created = await projects.createMilestone(globalScope, PROJECT_A, {
      name: "Closure milestone",
      dueDate: "2026-08-15",
    }, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    expect((await projects.listMilestones(assignedA, PROJECT_A))?.some((item) => item.id === created.id))
      .toBe(true);
    expect((await projects.findMilestone(assignedA, PROJECT_A, created.id))?.id).toBe(created.id);
    const completed = await projects.updateMilestone(globalScope, PROJECT_A, created.id, {
      status: "completed",
      expectedUpdatedAt: created.updatedAt,
    }, audit());
    expect(completed).toMatchObject({ status: "completed" });
    expect(typeof completed === "object" && completed.completedAt).toBeInstanceOf(Date);
    expect(await projects.createMilestone(globalScope, PROJECT_A, {
      name: "Outside",
      dueDate: "2027-01-01",
    }, audit())).toBe("invalid_dates");
    expect(await projects.listMilestones(organizationB, PROJECT_A)).toBeNull();

    const concurrent = await projects.createMilestone(globalScope, PROJECT_A, {
      name: "Concurrent milestone",
      dueDate: "2026-08-20",
    }, audit());
    expect(typeof concurrent).toBe("object");
    if (typeof concurrent !== "object") return;
    const results = await Promise.all([
      projects.updateMilestone(globalScope, PROJECT_A, concurrent.id, {
        name: "First",
        expectedUpdatedAt: concurrent.updatedAt,
      }, audit()),
      projects.updateMilestone(globalScope, PROJECT_A, concurrent.id, {
        name: "Second",
        expectedUpdatedAt: concurrent.updatedAt,
      }, audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
  });

  it("enforces optional deliverable milestone integrity and audited approval", async () => {
    const milestoneA = await projects.createMilestone(globalScope, PROJECT_A, {
      name: "Deliverable milestone A",
      dueDate: "2026-08-25",
    }, audit());
    const milestoneB = await projects.createMilestone(globalScope, PROJECT_B, {
      name: "Deliverable milestone B",
      dueDate: "2026-08-25",
    }, audit());
    expect(typeof milestoneA).toBe("object");
    expect(typeof milestoneB).toBe("object");
    if (typeof milestoneA !== "object" || typeof milestoneB !== "object") return;

    const created = await projects.createDeliverable(globalScope, PROJECT_A, {
      name: "Closure deliverable",
      milestoneId: milestoneA.id,
    }, audit());
    expect(created).toMatchObject({ milestoneId: milestoneA.id, status: "pending" });
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    expect((await projects.listDeliverables(assignedA, PROJECT_A))?.some((item) => item.id === created.id))
      .toBe(true);
    expect((await projects.findDeliverable(assignedA, PROJECT_A, created.id))?.id).toBe(created.id);
    expect(await projects.createDeliverable(globalScope, PROJECT_A, {
      name: "Wrong milestone",
      milestoneId: milestoneB.id,
    }, audit())).toBe("not_found");
    await expect(pool.query(
      `INSERT INTO deliverables (project_id,organization_id,milestone_id,name,status)
       VALUES ($1,$2,$3,'Cross-project','pending')`,
      [PROJECT_A, ORG_A, milestoneB.id],
    )).rejects.toMatchObject({ code: "23503" });

    const approved = await projects.updateDeliverable(
      globalScope,
      PROJECT_A,
      created.id,
      { status: "approved", expectedUpdatedAt: created.updatedAt },
      USER_ADMIN,
      audit(),
    );
    expect(approved).toMatchObject({
      status: "approved",
      approvedByUserId: USER_ADMIN,
      milestoneId: milestoneA.id,
    });
    expect(typeof approved === "object" && approved.approvedAt).toBeInstanceOf(Date);
    expect(await projects.listDeliverables(organizationB, PROJECT_A)).toBeNull();
  });

  it("detects concurrent deliverable updates and rejects closed projects", async () => {
    const created = await projects.createDeliverable(globalScope, PROJECT_A, {
      name: "Concurrent deliverable",
    }, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const results = await Promise.all([
      projects.updateDeliverable(globalScope, PROJECT_A, created.id, {
        name: "First",
        expectedUpdatedAt: created.updatedAt,
      }, USER_ADMIN, audit()),
      projects.updateDeliverable(globalScope, PROJECT_A, created.id, {
        name: "Second",
        expectedUpdatedAt: created.updatedAt,
      }, USER_ADMIN, audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    await pool.query("UPDATE projects SET status='cancelled' WHERE id=$1", [PROJECT_B]);
    expect(await projects.createDeliverable(globalScope, PROJECT_B, {
      name: "Closed",
    }, audit())).toBe("conflict");
    await pool.query("UPDATE projects SET status='planning' WHERE id=$1", [PROJECT_B]);
  });

  it("updates projects with optimistic timestamps and protects stale writes", async () => {
    const current = await projects.findAuthorized(globalScope, PROJECT_A);
    expect(current).not.toBeNull();
    if (current === null) return;
    const updated = await projects.update(globalScope, PROJECT_A, {
      name: "Closure Project A Updated",
      expectedUpdatedAt: current.updatedAt,
    }, audit());
    expect(updated).toMatchObject({ name: "Closure Project A Updated" });
    expect(await projects.update(globalScope, PROJECT_A, {
      name: "Stale",
      expectedUpdatedAt: current.updatedAt,
    }, audit())).toBe("conflict");
  });

  it("applies task filters and global/assigned/own/organization scopes to count and rows", async () => {
    expect(await tasks.create(globalScope, {
      projectId: PROJECT_A,
      title: "Client cannot own operational task",
      description: "Tenant member is not an internal assignee",
      assignedToUserId: USER_MEMBER,
      dueDate: "2026-08-10",
    }, USER_ADMIN, audit())).toBe("ineligible_user");
    const projectTask = await tasks.create(globalScope, {
      projectId: PROJECT_A,
      title: "Scoped project task",
      description: "Filtered",
      assignedToUserId: USER_ADMIN,
      dueDate: "2026-08-10",
    }, USER_ADMIN, audit());
    const standalone = await tasks.create(globalScope, {
      title: "Scoped standalone task",
      description: "Private",
      assignedToUserId: USER_ADMIN,
      dueDate: "2026-08-11",
    }, USER_ADMIN, audit());
    expect(typeof projectTask).toBe("object");
    expect(typeof standalone).toBe("object");
    if (typeof projectTask !== "object" || typeof standalone !== "object") return;
    const input = {
      page: 1,
      pageSize: 20,
      search: "Scoped",
      sortBy: "title" as const,
      sortDirection: "asc" as const,
    };
    expect((await tasks.listAuthorized(globalScope, input)).pagination.total).toBe(2);
    expect((await tasks.listAuthorized(assignedA, input)).items.map((item) => item.id))
      .toEqual([projectTask.id]);
    expect((await tasks.listAuthorized(ownA, input)).pagination.total).toBe(2);
    expect((await tasks.listAuthorized(organizationA, input)).items.map((item) => item.id))
      .toEqual([projectTask.id]);
    expect((await tasks.listAuthorized({ kind: "public", actorId: USER_MEMBER }, input)).pagination.total)
      .toBe(0);
    expect((await tasks.listAuthorized(globalScope, {
      ...input,
      projectId: PROJECT_A,
      status: "pending",
      assignedToUserId: USER_ADMIN,
      createdByUserId: USER_ADMIN,
      dueFrom: "2026-08-01",
      dueTo: "2026-08-31",
    })).pagination.total).toBe(1);
  });

  it("updates tasks and rejects a stale expectedUpdatedAt", async () => {
    const created = await tasks.create(globalScope, {
      title: "Patch closure task",
      description: "Private",
      assignedToUserId: USER_ADMIN,
      dueDate: "2026-08-12",
    }, USER_ADMIN, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const updated = await tasks.update(globalScope, created.id, {
      title: "Patched closure task",
      expectedUpdatedAt: created.updatedAt,
    }, audit());
    expect(updated).toMatchObject({ title: "Patched closure task" });
    expect(await tasks.update(globalScope, created.id, {
      title: "Stale task",
      expectedUpdatedAt: created.updatedAt,
    }, audit())).toBe("conflict");
  });

  it("revokes membership idempotently and removes identity, project and task access immediately", async () => {
    const created = await projects.createMember(
      globalScope,
      PROJECT_A,
      USER_REVOKED,
      "project_member",
      audit(),
    );
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    expect((await identity.findByClerkUserId("closure_revoked"))?.actor.roles
      .some((role) => role.scope === "project" && role.projectId === PROJECT_A)).toBe(true);

    const revoked = await projects.revokeMember(
      globalScope,
      PROJECT_A,
      USER_REVOKED,
      created.updatedAt,
      USER_ADMIN,
      audit(),
    );
    expect(revoked).toMatchObject({
      userId: USER_REVOKED,
      status: "revoked",
      revokedByUserId: USER_ADMIN,
    });
    expect(typeof revoked === "object" && revoked.revokedAt).toBeInstanceOf(Date);
    expect(await projects.revokeMember(
      globalScope,
      PROJECT_A,
      USER_REVOKED,
      created.updatedAt,
      USER_ADMIN,
      audit(),
    )).toMatchObject({ status: "revoked" });
    expect((await projects.listMembers(globalScope, PROJECT_A))?.some((item) => item.userId === USER_REVOKED))
      .toBe(false);
    expect((await identity.findByClerkUserId("closure_revoked"))?.actor.roles
      .some((role) => role.scope === "project" && role.projectId === PROJECT_A)).toBe(false);
    expect(await projects.findAuthorized({
      kind: "assigned",
      actorId: USER_REVOKED,
      organizationIds: [ORG_A],
    }, PROJECT_A)).toBeNull();
    expect(await tasks.create(globalScope, {
      projectId: PROJECT_A,
      title: "Revoked assignee",
      description: "Must fail",
      assignedToUserId: USER_REVOKED,
      dueDate: "2026-08-15",
    }, USER_ADMIN, audit())).toBe("ineligible_user");
    const auditCount = await pool.query<{ readonly count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE action='project_member.revoked' AND entity_id=$1
         AND new_values->>'userId'=$2`,
      [PROJECT_A, USER_REVOKED],
    );
    expect(auditCount.rows[0]?.count).toBe(1);
  });
});
