import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresProjectRepository } from "../../src/modules/projects/project.repository.js";
import { PostgresTaskRepository } from "../../src/modules/tasks/task.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const USER_ADMIN = "20000000-0000-4000-8000-000000000001";
const USER_MEMBER = "20000000-0000-4000-8000-000000000002";
const USER_SECOND = "20000000-0000-4000-8000-000000000003";
const ORG_A = "20000000-0000-4000-8000-000000000101";
const ORG_B = "20000000-0000-4000-8000-000000000102";
const PROJECT_A = "20000000-0000-4000-8000-000000000201";
const PROJECT_B = "20000000-0000-4000-8000-000000000202";

describe.skipIf(testDatabaseUrl === undefined)("Phase 5 PostgreSQL behavior", () => {
  const schema = `ilvox_phase5_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const globalScope = { kind: "global" as const, actorId: USER_ADMIN, crossOrganization: true as const };
  const scopeA = { kind: "organization" as const, actorId: USER_MEMBER, organizationIds: [ORG_A] };
  const assignedA = { kind: "assigned" as const, actorId: USER_MEMBER, organizationIds: [ORG_A] };
  const audit = () => ({ actorUserId: USER_ADMIN, requestId: randomUUID() });
  let admin: pg.Client;
  let pool: Pool;
  let projects: PostgresProjectRepository;
  let tasks: PostgresTaskRepository;

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
      max: 6,
      options: `-c search_path=${schema},public`,
    });
    projects = new PostgresProjectRepository(pool);
    tasks = new PostgresTaskRepository(pool);
    await pool.query(
      `INSERT INTO app_users (id, clerk_user_id, primary_email, status) VALUES
       ($1,'phase5_admin','admin@example.test','active'),
       ($2,'phase5_member','member@example.test','active'),
       ($3,'phase5_second','second@example.test','active')`,
      [USER_ADMIN, USER_MEMBER, USER_SECOND],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, role_scope)
       SELECT $1,id,'global' FROM roles WHERE scope='global' AND code='admin'`,
      [USER_ADMIN],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, role_scope)
       SELECT $1,id,'global' FROM roles WHERE scope='global' AND code='contributor'`,
      [USER_SECOND],
    );
    await pool.query(
      `INSERT INTO organizations (id,name,status) VALUES
       ($1,'Phase 5 A','active'),($2,'Phase 5 B','active')`,
      [ORG_A, ORG_B],
    );
    await pool.query(
      `INSERT INTO projects (
         id,organization_id,name,description,status,priority,lead_user_id,
         start_date,due_date,created_by_user_id
       ) VALUES
       ($1,$2,'Project A','A','planning','medium',$3,'2026-07-01','2026-09-01',$3),
       ($4,$5,'Project B','B','planning','medium',$3,'2026-07-01','2026-09-01',$3)`,
      [PROJECT_A, ORG_A, USER_ADMIN, PROJECT_B, ORG_B],
    );
    await pool.query(
      `INSERT INTO project_members (
         project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
       )
       SELECT $1,$2,$3,id,'project',$4 FROM roles
       WHERE scope='project' AND code='project_member'`,
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

  it("keeps projects organization-bound and tasks contextually valid", async () => {
    await expect(pool.query(
      `INSERT INTO projects (
         organization_id,name,description,lead_user_id,start_date,due_date,created_by_user_id
       ) VALUES (NULL,'Invalid','Invalid',$1,'2026-07-01','2026-08-01',$1)`,
      [USER_ADMIN],
    )).rejects.toMatchObject({ code: "23502" });
    const standalone = await tasks.create(globalScope, {
      title: "Standalone",
      description: "Internal",
      assignedToUserId: USER_ADMIN,
      dueDate: "2026-08-01",
    }, USER_ADMIN, audit());
    expect(standalone).toMatchObject({ organizationId: null, projectId: null });
    await expect(pool.query(
      "UPDATE tasks SET project_id=$1 WHERE id=$2",
      [PROJECT_A, typeof standalone === "object" ? standalone.id : randomUUID()],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("applies the same project scope to list, detail, and count", async () => {
    const list = await projects.listAuthorized(scopeA, {
      page: 1,
      pageSize: 20,
      sortBy: "createdAt",
      sortDirection: "asc",
    });
    expect(list.pagination.total).toBe(1);
    expect(list.items.map((item) => item.id)).toEqual([PROJECT_A]);
    expect(await projects.findAuthorized(scopeA, PROJECT_B)).toBeNull();
    expect((await projects.findAuthorized(assignedA, PROJECT_A))?.id).toBe(PROJECT_A);
  });

  it("serializes duplicate project membership", async () => {
    const results = await Promise.all([
      projects.createMember(globalScope, PROJECT_A, USER_SECOND, "project_member", audit()),
      projects.createMember(globalScope, PROJECT_A, USER_SECOND, "project_member", audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
  });

  it("detects concurrent project transitions", async () => {
    const results = await Promise.all([
      projects.transition(globalScope, PROJECT_A, "planning", "in_progress", undefined, audit()),
      projects.transition(globalScope, PROJECT_A, "planning", "cancelled", "Cancelled", audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
    await pool.query("UPDATE projects SET status='in_progress' WHERE id=$1", [PROJECT_A]);
  });

  it("detects concurrent milestone updates using observed timestamps", async () => {
    const milestone = await projects.createMilestone(globalScope, PROJECT_A, {
      name: "Milestone",
      dueDate: "2026-08-01",
    }, audit());
    expect(typeof milestone).toBe("object");
    if (typeof milestone !== "object") return;
    const results = await Promise.all([
      projects.updateMilestone(globalScope, PROJECT_A, milestone.id, {
        name: "First",
        expectedUpdatedAt: milestone.updatedAt,
      }, audit()),
      projects.updateMilestone(globalScope, PROJECT_A, milestone.id, {
        name: "Second",
        expectedUpdatedAt: milestone.updatedAt,
      }, audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
  });

  it("detects concurrent task assignments and preserves one winner", async () => {
    const created = await tasks.create(globalScope, {
      projectId: PROJECT_A,
      title: "Assigned",
      description: "Concurrent",
      assignedToUserId: USER_MEMBER,
      dueDate: "2026-08-01",
    }, USER_ADMIN, audit());
    expect(typeof created).toBe("object");
    if (typeof created !== "object") return;
    const results = await Promise.all([
      tasks.assign(globalScope, created.id, USER_SECOND, created.updatedAt, audit()),
      tasks.assign(globalScope, created.id, USER_MEMBER, created.updatedAt, audit()),
    ]);
    expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
  });

  it("serializes task creation behind a concurrent project cancellation", async () => {
    expect(typeof await projects.createMember(
      globalScope,
      PROJECT_B,
      USER_SECOND,
      "project_member",
      audit(),
    )).toBe("object");
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT 1 FROM projects WHERE id=$1 FOR UPDATE", [PROJECT_B]);
      await blocker.query("UPDATE projects SET status='cancelled' WHERE id=$1", [PROJECT_B]);
      const creation = tasks.create(globalScope, {
        projectId: PROJECT_B,
        title: "Too late",
        description: "Must fail",
        assignedToUserId: USER_SECOND,
        dueDate: "2026-08-01",
      }, USER_ADMIN, audit());
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      await blocker.query("COMMIT");
      expect(await creation).toBe("project_closed");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
  });

  it("rolls back project creation when audit persistence fails", async () => {
    await expect(projects.create(globalScope, {
      organizationId: ORG_A,
      name: "Rollback project",
      description: "Must roll back",
      leadUserId: USER_ADMIN,
      startDate: "2026-07-01",
      dueDate: "2026-08-01",
    }, USER_ADMIN, { actorUserId: USER_ADMIN, requestId: "invalid-uuid" })).rejects
      .toMatchObject({ code: "22P02" });
    expect((await pool.query<{ readonly total: number }>(
      "SELECT count(*)::int AS total FROM projects WHERE name='Rollback project'",
    )).rows[0]?.total).toBe(0);
  });
});
