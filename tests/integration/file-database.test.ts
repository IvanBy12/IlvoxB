import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileRepository } from "../../src/modules/files/file.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const USER_ID = "a0000000-0000-4000-8000-000000000001";
const ORG_A = "a0000000-0000-4000-8000-000000000002";
const ORG_B = "a0000000-0000-4000-8000-000000000003";
const PROJECT_A = "a0000000-0000-4000-8000-000000000004";
const PROJECT_B = "a0000000-0000-4000-8000-000000000005";
const DELIVERABLE_A = "a0000000-0000-4000-8000-000000000006";
const DELIVERABLE_B = "a0000000-0000-4000-8000-000000000007";

describe.skipIf(testDatabaseUrl === undefined)("deliverable files on real PostgreSQL", () => {
  const schema = `ilvox_files_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  let admin: pg.Client;
  let pool: Pool;
  let repository: FileRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quote(schema)}`);
    await admin.query(`SET search_path TO ${quote(schema)}, public`);
    await admin.query(readFileSync(resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"), "utf8"));
    for (const migration of [
      "0001_phase3-rbac-separation.sql",
      "0002_phase3-file-audience.sql",
      "0006_phase5-member-revocation.sql",
      "0007_phase5-deliverable-milestone.sql",
      "0013_project-deliverable-files.sql",
    ]) {
      const sql = readFileSync(resolve("drizzle", "migrations", migration), "utf8")
        .replaceAll("--> statement-breakpoint", "")
        .replaceAll('"public".', `${quote(schema)}.`);
      await admin.query(sql);
    }
    pool = new Pool({ connectionString: testDatabaseUrl, max: 4, options: `-c search_path=${schema},public` });
    repository = new FileRepository(pool);
    await pool.query(`INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,last_name,status)
      VALUES ($1,'files_user','files@example.test','File','Owner','active')`, [USER_ID]);
    await pool.query(`INSERT INTO organizations (id,name) VALUES ($1,'Organization A'),($2,'Organization B')`, [ORG_A, ORG_B]);
    await pool.query(`INSERT INTO projects
      (id,organization_id,name,description,status,priority,lead_user_id,start_date,due_date,created_by_user_id)
      VALUES ($1,$2,'Project A','A','in_progress','medium',$3,'2026-08-01','2026-10-31',$3),
             ($4,$5,'Project B','B','in_progress','medium',$3,'2026-08-01','2026-10-31',$3)`,
    [PROJECT_A, ORG_A, USER_ID, PROJECT_B, ORG_B]);
    await pool.query(`INSERT INTO deliverables
      (id,project_id,organization_id,name,status,delivery_party,due_date)
      VALUES ($1,$2,$3,'Client request A','pending','client','2026-09-15'),
             ($4,$5,$6,'Client request B','pending','client','2026-09-15')`,
    [DELIVERABLE_A, PROJECT_A, ORG_A, DELIVERABLE_B, PROJECT_B, ORG_B]);
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query("RESET search_path").catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      await admin.end();
    }
  });

  it("supports several files, tenant-scoped lookup and idempotent completion", async () => {
    const scopeA = { kind: "organization" as const, actorId: USER_ID, organizationIds: [ORG_A] };
    const scopeB = { kind: "organization" as const, actorId: USER_ID, organizationIds: [ORG_B] };
    const audit = { actorUserId: USER_ID, organizationId: ORG_A, requestId: randomUUID() };
    const first = await repository.createPending({
      organizationId: ORG_A,
      deliverableId: DELIVERABLE_A,
      uploadedByUserId: USER_ID,
      originalName: "manual.pdf",
      storageProvider: "r2",
      objectKey: `organizations/${ORG_A}/deliverables/${DELIVERABLE_A}/${randomUUID()}`,
      mimeType: "application/pdf",
      sizeBytes: 5,
    }, audit);
    const second = await repository.createPending({
      organizationId: ORG_A,
      deliverableId: DELIVERABLE_A,
      uploadedByUserId: USER_ID,
      originalName: "data.xlsx",
      storageProvider: "r2",
      objectKey: `organizations/${ORG_A}/deliverables/${DELIVERABLE_A}/${randomUUID()}`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 8,
    }, audit);

    expect((await repository.listByDeliverable(DELIVERABLE_A, scopeA, ["organization"]))?.map((file) => file.id)).toEqual([first.id, second.id]);
    expect(await repository.findAuthorizedById(first.id, scopeB, ["organization"])).toBeNull();
    expect(await repository.listByDeliverable(DELIVERABLE_A, scopeB, ["organization"])).toBeNull();

    expect(await repository.complete(first.id, scopeA, audit)).toMatchObject({ status: "active" });
    expect(await repository.complete(first.id, scopeA, audit)).toMatchObject({ status: "active" });
    const deliverable = await pool.query<{ readonly status: string }>("SELECT status FROM deliverables WHERE id=$1", [DELIVERABLE_A]);
    expect(deliverable.rows[0]?.status).toBe("in_review");
    const count = await pool.query<{ readonly count: string }>("SELECT count(*)::text count FROM files WHERE deliverable_id=$1", [DELIVERABLE_A]);
    expect(Number(count.rows[0]?.count)).toBe(2);
  });

  it("enforces the client delivery due-date invariant in PostgreSQL", async () => {
    await expect(pool.query(`INSERT INTO deliverables
      (project_id,organization_id,name,status,delivery_party)
      VALUES ($1,$2,'Invalid request','pending','client')`, [PROJECT_A, ORG_A])).rejects.toMatchObject({ constraint: "chk_deliverables_client_due_date" });
  });
});
