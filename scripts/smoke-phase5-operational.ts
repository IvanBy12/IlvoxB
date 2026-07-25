import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";
import { PostgresIdentityRepository } from "../src/modules/identity/identity.repository.js";
import { PostgresProjectRepository } from "../src/modules/projects/project.repository.js";
import { PostgresTaskRepository } from "../src/modules/tasks/task.repository.js";
import { FileRepository } from "../src/modules/files/file.repository.js";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  console.error("DATABASE_URL_MISSING");
  process.exit(2);
}

const suffix = randomUUID().replaceAll("-", "");
const ids = {
  actor: randomUUID(),
  member: randomUUID(),
  otherMember: randomUUID(),
  organization: randomUUID(),
  projectA: randomUUID(),
  projectB: randomUUID(),
  milestoneA: randomUUID(),
  milestoneB: randomUUID(),
  task: randomUUID(),
  file: randomUUID(),
};
const clerkIds = {
  actor: `phase5_smoke_actor_${suffix}`,
  member: `phase5_smoke_member_${suffix}`,
  otherMember: `phase5_smoke_other_${suffix}`,
};
const pool = new Pool({ connectionString, max: 8 });
const identity = new PostgresIdentityRepository(pool);
const projects = new PostgresProjectRepository(pool);
const tasks = new PostgresTaskRepository(pool);
const files = new FileRepository(pool);
const auth: AuthenticationProvider = {
  authenticate: (request) => {
    const header = request.headers["x-smoke-clerk-user"];
    return Promise.resolve(typeof header === "string" ? { clerkUserId: header } : null);
  },
};
const app = await buildApp({
  env: {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "3002",
    LOG_LEVEL: "silent",
    TRUST_PROXY: "false",
    CORS_ORIGINS: "http://localhost:5173",
    BODY_LIMIT_BYTES: "1048576",
    RATE_LIMIT_MAX: "1000",
    RATE_LIMIT_WINDOW: "1 minute",
  },
  logger: false,
  authenticationProvider: auth,
});
const actorHeaders = { "x-smoke-clerk-user": clerkIds.actor };
const assignedMemberScope = {
  kind: "assigned" as const,
  actorId: ids.member,
  organizationIds: [ids.organization],
};
const assignedOtherScope = {
  kind: "assigned" as const,
  actorId: ids.otherMember,
  organizationIds: [ids.organization],
};

function body<T>(response: { json<TValue>(): TValue }): T {
  return response.json<T>();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let deliverableId: string | undefined;
let directCrossProjectSqlState: string | undefined;

try {
  await pool.query(
    `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
     ($1,$2,$3,'active'),($4,$5,$6,'active'),($7,$8,$9,'active')`,
    [
      ids.actor,
      clerkIds.actor,
      `phase5-smoke-actor-${suffix}@example.test`,
      ids.member,
      clerkIds.member,
      `phase5-smoke-member-${suffix}@example.test`,
      ids.otherMember,
      clerkIds.otherMember,
      `phase5-smoke-other-${suffix}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope)
     SELECT $1,id,'global' FROM roles
     WHERE scope='global' AND code='super_admin'`,
    [ids.actor],
  );
  await pool.query(
    `INSERT INTO organizations (id,name,status)
     VALUES ($1,$2,'active')`,
    [ids.organization, `Phase 5 operational smoke ${suffix}`],
  );
  await pool.query(
    `INSERT INTO projects (
       id,organization_id,name,description,status,priority,lead_user_id,
       start_date,due_date,created_by_user_id
     ) VALUES
     ($1,$3,'Operational project A','Phase 5 smoke A','planning','medium',$4,
       '2026-07-01','2026-09-30',$4),
     ($2,$3,'Operational project B','Phase 5 smoke B','planning','medium',$4,
       '2026-07-01','2026-09-30',$4)`,
    [ids.projectA, ids.projectB, ids.organization, ids.actor],
  );
  for (const userId of [ids.member, ids.otherMember]) {
    await pool.query(
      `INSERT INTO project_members (
         project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
       )
       SELECT $1,$2,$3,id,'project',$4
       FROM roles WHERE scope='project' AND code='project_member'`,
      [ids.projectA, ids.organization, userId, ids.actor],
    );
  }
  await pool.query(
    `INSERT INTO tasks (
       id,organization_id,project_id,title,description,assigned_to_user_id,
       created_by_user_id,priority,status,due_date
     ) VALUES ($1,$2,$3,'Operational task','Revocation access smoke',$4,$5,
       'medium','pending','2026-08-01')`,
    [ids.task, ids.organization, ids.projectA, ids.member, ids.actor],
  );
  await pool.query(
    `INSERT INTO files (
       id,organization_id,project_id,uploaded_by_user_id,original_name,
       storage_provider,object_key,mime_type,size_bytes,classification,audience,status
     ) VALUES ($1,$2,$3,$4,'operational-smoke.txt','smoke',$5,
       'text/plain',1,'confidential','internal','active')`,
    [ids.file, ids.organization, ids.projectA, ids.actor, `phase5/${suffix}.txt`],
  );
  await pool.query(
    `INSERT INTO project_milestones (
       id,project_id,organization_id,name,status,due_date
     ) VALUES
     ($1,$3,$5,'Milestone A','pending','2026-08-15'),
     ($2,$4,$5,'Milestone B','pending','2026-08-15')`,
    [ids.milestoneA, ids.milestoneB, ids.projectA, ids.projectB, ids.organization],
  );

  const identityBefore = await identity.findByClerkUserId(clerkIds.member);
  assert(identityBefore?.actor.roles.some((role) =>
    role.scope === "project" && role.projectId === ids.projectA), "MEMBER_PROJECT_ROLE_MISSING_BEFORE");
  assert(await projects.findAuthorized(assignedMemberScope, ids.projectA) !== null,
    "MEMBER_PROJECT_ACCESS_MISSING_BEFORE");
  assert(await tasks.findAuthorized(assignedMemberScope, ids.task) !== null,
    "MEMBER_TASK_ACCESS_MISSING_BEFORE");
  assert(await files.findAuthorizedById(ids.file, assignedMemberScope, ["internal"]) !== null,
    "MEMBER_FILE_ACCESS_MISSING_BEFORE");

  const revoked = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${ids.projectA}/members/${ids.member}/revoke`,
    headers: actorHeaders,
    payload: {},
  });
  assert(revoked.statusCode === 200, `REVOKE_HTTP_${revoked.statusCode}`);
  const revokedData = body<{
    data: {
      status: string;
      revokedAt: string | null;
      revokedByUserId: string | null;
    };
  }>(revoked).data;
  assert(revokedData.status === "revoked", "REVOKE_STATUS_MISMATCH");
  assert(revokedData.revokedAt !== null, "REVOKE_TIMESTAMP_MISSING");
  assert(revokedData.revokedByUserId === ids.actor, "REVOKE_ACTOR_MISMATCH");

  const secondRevoke = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${ids.projectA}/members/${ids.member}/revoke`,
    headers: actorHeaders,
    payload: {},
  });
  assert(secondRevoke.statusCode === 200, `SECOND_REVOKE_HTTP_${secondRevoke.statusCode}`);
  const auditCount = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM audit_events
     WHERE organization_id=$1 AND action='project_member.revoked'
       AND entity_type='project_member' AND entity_id=$2`,
    [ids.organization, ids.projectA],
  );
  assert(auditCount.rows[0]?.count === 1, "REVOKE_AUDIT_NOT_IDEMPOTENT");

  const historicalMember = await pool.query<{
    status: string;
    revoked_at: Date | null;
    revoked_by_user_id: string | null;
  }>(
    `SELECT status,revoked_at,revoked_by_user_id
     FROM project_members WHERE project_id=$1 AND user_id=$2`,
    [ids.projectA, ids.member],
  );
  assert(historicalMember.rows[0]?.status === "revoked", "MEMBER_HISTORY_NOT_PRESERVED");
  const activeMembers = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${ids.projectA}/members`,
    headers: actorHeaders,
  });
  assert(activeMembers.statusCode === 200, `MEMBER_LIST_HTTP_${activeMembers.statusCode}`);
  const activeMemberIds = body<{ data: Array<{ userId: string }> }>(activeMembers)
    .data.map((member) => member.userId);
  assert(!activeMemberIds.includes(ids.member), "REVOKED_MEMBER_IN_ACTIVE_LIST");
  assert(activeMemberIds.includes(ids.otherMember), "OTHER_ACTIVE_MEMBER_LOST");

  const identityAfter = await identity.findByClerkUserId(clerkIds.member);
  assert(identityAfter !== null, "LOCAL_USER_REMOVED");
  assert(!identityAfter.actor.roles.some((role) => role.scope === "project"),
    "REVOKED_PROJECT_ROLE_STILL_EFFECTIVE");
  assert(await projects.findAuthorized(assignedMemberScope, ids.projectA) === null,
    "REVOKED_PROJECT_ACCESS_RETAINED");
  assert(await tasks.findAuthorized(assignedMemberScope, ids.task) === null,
    "REVOKED_TASK_ACCESS_RETAINED");
  assert(await files.findAuthorizedById(ids.file, assignedMemberScope, ["internal"]) === null,
    "REVOKED_FILE_ACCESS_RETAINED");
  assert(await projects.findAuthorized(assignedOtherScope, ids.projectA) !== null,
    "OTHER_MEMBER_PROJECT_ACCESS_LOST");

  const created = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${ids.projectA}/deliverables`,
    headers: actorHeaders,
    payload: { name: "Operational deliverable", milestoneId: ids.milestoneA },
  });
  assert(created.statusCode === 201, `DELIVERABLE_CREATE_HTTP_${created.statusCode}`);
  const createdData = body<{
    data: { id: string; milestoneId: string | null; updatedAt: string };
  }>(created).data;
  deliverableId = createdData.id;
  assert(createdData.milestoneId === ids.milestoneA, "DELIVERABLE_MILESTONE_CREATE_MISMATCH");

  const cleared = await app.inject({
    method: "PATCH",
    url: `/api/v1/projects/${ids.projectA}/deliverables/${deliverableId}`,
    headers: actorHeaders,
    payload: { milestoneId: null, expectedUpdatedAt: createdData.updatedAt },
  });
  assert(cleared.statusCode === 200, `DELIVERABLE_CLEAR_HTTP_${cleared.statusCode}`);
  const clearedData = body<{ data: { milestoneId: string | null; updatedAt: string } }>(cleared).data;
  assert(clearedData.milestoneId === null, "DELIVERABLE_MILESTONE_NOT_CLEARED");

  const reassigned = await app.inject({
    method: "PATCH",
    url: `/api/v1/projects/${ids.projectA}/deliverables/${deliverableId}`,
    headers: actorHeaders,
    payload: { milestoneId: ids.milestoneA, expectedUpdatedAt: clearedData.updatedAt },
  });
  assert(reassigned.statusCode === 200, `DELIVERABLE_REASSIGN_HTTP_${reassigned.statusCode}`);
  const reassignedData = body<{ data: { updatedAt: string } }>(reassigned).data;

  const crossProject = await app.inject({
    method: "PATCH",
    url: `/api/v1/projects/${ids.projectA}/deliverables/${deliverableId}`,
    headers: actorHeaders,
    payload: { milestoneId: ids.milestoneB, expectedUpdatedAt: reassignedData.updatedAt },
  });
  assert(crossProject.statusCode === 404, `CROSS_PROJECT_HTTP_${crossProject.statusCode}`);

  const protectedBody = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${ids.projectA}/deliverables`,
    headers: actorHeaders,
    payload: {
      name: "Protected body",
      projectId: ids.projectB,
      organizationId: ids.organization,
    },
  });
  assert(protectedBody.statusCode === 400, `PROTECTED_BODY_HTTP_${protectedBody.statusCode}`);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO deliverables (
         project_id,organization_id,milestone_id,name,status
       ) VALUES ($1,$2,$3,'Direct cross-project smoke','pending')`,
      [ids.projectA, ids.organization, ids.milestoneB],
    );
  } catch (error: unknown) {
    directCrossProjectSqlState = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  } finally {
    await pool.query("ROLLBACK");
  }
  assert(directCrossProjectSqlState === "23503", "DIRECT_CROSS_PROJECT_NOT_REJECTED");

  const concurrent = await Promise.all([
    app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${ids.projectA}/deliverables/${deliverableId}`,
      headers: actorHeaders,
      payload: { name: "Concurrent first", expectedUpdatedAt: reassignedData.updatedAt },
    }),
    app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${ids.projectA}/deliverables/${deliverableId}`,
      headers: actorHeaders,
      payload: { name: "Concurrent second", expectedUpdatedAt: reassignedData.updatedAt },
    }),
  ]);
  assert(concurrent.filter((response) => response.statusCode === 200).length === 1,
    "DELIVERABLE_CONCURRENCY_WINNER_MISMATCH");
  assert(concurrent.filter((response) => response.statusCode === 409).length === 1,
    "DELIVERABLE_CONCURRENCY_CONFLICT_MISMATCH");

  await pool.query("UPDATE projects SET status='delivered' WHERE id=$1", [ids.projectA]);
  const closedProject = await app.inject({
    method: "PATCH",
    url: `/api/v1/projects/${ids.projectA}/deliverables/${deliverableId}`,
    headers: actorHeaders,
    payload: { name: "Must reject closed project" },
  });
  assert(closedProject.statusCode === 409, `CLOSED_PROJECT_HTTP_${closedProject.statusCode}`);

  console.log(JSON.stringify({
    ok: true,
    revocation: {
      statusCode: revoked.statusCode,
      idempotentStatusCode: secondRevoke.statusCode,
      auditEvents: auditCount.rows[0].count,
      historyPreserved: true,
      localUserPreserved: true,
      projectAccessRemoved: true,
      taskAccessRemoved: true,
      fileAccessRemoved: true,
      otherMemberAccessPreserved: true,
      activeListExcludesRevoked: true,
    },
    deliverableMilestone: {
      createStatusCode: created.statusCode,
      clearStatusCode: cleared.statusCode,
      reassignStatusCode: reassigned.statusCode,
      crossProjectStatusCode: crossProject.statusCode,
      directCrossProjectSqlState,
      protectedBodyStatusCode: protectedBody.statusCode,
      concurrencyStatusCodes: concurrent.map((response) => response.statusCode).sort(),
      closedProjectStatusCode: closedProject.statusCode,
    },
    clerkUsersCreated: 0,
    clerkSessionsCreated: 0,
    cleanup: "pending",
  }, null, 2));
} finally {
  await app.close().catch(() => undefined);
  await pool.query("BEGIN").catch(() => undefined);
  try {
    await pool.query("DELETE FROM audit_events WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM files WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM tasks WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM deliverables WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM project_milestones WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM project_members WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM projects WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM organization_memberships WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [
      [ids.actor, ids.member, ids.otherMember],
    ]);
    await pool.query("DELETE FROM organizations WHERE id=$1", [ids.organization]);
    await pool.query("DELETE FROM app_users WHERE id=ANY($1::uuid[])", [
      [ids.actor, ids.member, ids.otherMember],
    ]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    // A cleanup failure must fail the operational smoke even when the assertions passed.
    // eslint-disable-next-line no-unsafe-finally
    throw error;
  } finally {
    await pool.end();
  }
}
