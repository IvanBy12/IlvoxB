import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  throw new Error("DATABASE_URL_MISSING");
}

const suffix = randomUUID().replaceAll("-", "");
const marker = `PHASE74_SMOKE_${suffix}`;
const ids = {
  admin: randomUUID(),
  clientA: randomUUID(),
  clientB: randomUUID(),
  organizationA: randomUUID(),
  organizationB: randomUUID(),
  projectA: randomUUID(),
  projectB: randomUUID(),
  milestoneA: randomUUID(),
  milestoneB: randomUUID(),
  deliverableA: randomUUID(),
  deliverableB: randomUUID(),
};
const clerkIds = {
  admin: `${marker}_admin`,
  clientA: `${marker}_client_a`,
  clientB: `${marker}_client_b`,
};
const userIds = [ids.admin, ids.clientA, ids.clientB];
const organizationIds = [ids.organizationA, ids.organizationB];
const projectIds = [ids.projectA, ids.projectB];
const pool = new Pool({ connectionString, max: 12 });
const authenticationProvider: AuthenticationProvider = {
  authenticate: (request) => {
    const clerkUserId = request.headers["x-phase74-smoke-user"];
    return Promise.resolve(
      typeof clerkUserId === "string" ? { clerkUserId } : null,
    );
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
    RATE_LIMIT_MAX: "1000",
  },
  logger: false,
  authenticationProvider,
});

type InjectResponse = {
  readonly statusCode: number;
  json<T>(): T;
};
type Ticket = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly requesterUserId: string;
  readonly requestedPriority: string;
  readonly priority: string;
  readonly status: string;
  readonly updatedAt: string;
};
type Comment = {
  readonly id: string;
  readonly visibility: "client" | "internal";
  readonly content: string;
};
type Project = {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
};
type Identity = {
  readonly organizations: ReadonlyArray<{ readonly id: string }>;
};
type Page<T> = {
  readonly items: readonly T[];
  readonly pagination: { readonly total: number };
};

const headers = (clerkUserId: string) => ({
  "x-phase74-smoke-user": clerkUserId,
});
const data = <T>(response: InjectResponse): T =>
  response.json<{ data: T }>().data;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertStatus(
  response: InjectResponse,
  expected: number,
  label: string,
): void {
  assert(
    response.statusCode === expected,
    `${label}_EXPECTED_${expected}_GOT_${response.statusCode}`,
  );
}

const ticketIds: string[] = [];
const commentIds: string[] = [];
let smokeResult: Record<string, unknown> | undefined;
let smokeError: unknown;
let cleanupError: unknown;

const createTicket = async (
  payload: Record<string, unknown>,
): Promise<Ticket> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/tickets",
    headers: headers(clerkIds.clientA),
    payload,
  });
  assertStatus(response, 201, "TICKET_CREATE");
  const ticket = data<Ticket>(response);
  ticketIds.push(ticket.id);
  return ticket;
};

try {
  await pool.query(
    `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
     ($1,$2,$3,'active'),($4,$5,$6,'active'),($7,$8,$9,'active')`,
    [
      ids.admin,
      clerkIds.admin,
      `${marker}_admin@example.test`,
      ids.clientA,
      clerkIds.clientA,
      `${marker}_client_a@example.test`,
      ids.clientB,
      clerkIds.clientB,
      `${marker}_client_b@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope)
     SELECT $1,r.id,'global'
     FROM roles r WHERE r.scope='global' AND r.code='admin'`,
    [ids.admin],
  );
  await pool.query(
    `INSERT INTO organizations (id,name,status) VALUES
     ($1,$2,'active'),($3,$4,'active')`,
    [
      ids.organizationA,
      `${marker}_ORG_A`,
      ids.organizationB,
      `${marker}_ORG_B`,
    ],
  );
  await pool.query(
    `INSERT INTO organization_memberships (
       organization_id,user_id,role_id,role_scope,status,activated_at
     )
     SELECT fixture.organization_id,fixture.user_id,r.id,
            'organization','active',now()
     FROM (VALUES ($1::uuid,$2::uuid),($3::uuid,$4::uuid))
       fixture(organization_id,user_id)
     JOIN roles r ON r.scope='organization' AND r.code='client_contact'`,
    [ids.organizationA, ids.clientA, ids.organizationB, ids.clientB],
  );
  await pool.query(
    `INSERT INTO projects (
       id,organization_id,name,description,status,priority,lead_user_id,
       start_date,due_date,created_by_user_id
     ) VALUES
     ($1,$2,$3,$4,'in_progress','medium',$5,'2026-07-01','2026-09-30',$5),
     ($6,$7,$8,$9,'in_progress','medium',$5,'2026-07-01','2026-09-30',$5)`,
    [
      ids.projectA,
      ids.organizationA,
      `${marker}_PROJECT_A`,
      "Portal A",
      ids.admin,
      ids.projectB,
      ids.organizationB,
      `${marker}_PROJECT_B`,
      "Portal B",
    ],
  );
  await pool.query(
    `INSERT INTO project_members (
       project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
     )
     SELECT fixture.project_id,fixture.organization_id,fixture.user_id,
            r.id,'project',$5
     FROM (VALUES
       ($1::uuid,$2::uuid,$3::uuid),($4::uuid,$6::uuid,$7::uuid)
     ) fixture(project_id,organization_id,user_id)
     JOIN roles r ON r.scope='project' AND r.code='project_member'`,
    [
      ids.projectA,
      ids.organizationA,
      ids.clientA,
      ids.projectB,
      ids.admin,
      ids.organizationB,
      ids.clientB,
    ],
  );
  await pool.query(
    `INSERT INTO project_milestones (
       id,project_id,organization_id,name,status,due_date
     ) VALUES
     ($1,$2,$3,$4,'in_progress','2026-08-15'),
     ($5,$6,$7,$8,'pending','2026-08-20')`,
    [
      ids.milestoneA,
      ids.projectA,
      ids.organizationA,
      `${marker}_MILESTONE_A`,
      ids.milestoneB,
      ids.projectB,
      ids.organizationB,
      `${marker}_MILESTONE_B`,
    ],
  );
  await pool.query(
    `INSERT INTO deliverables (
       id,project_id,organization_id,milestone_id,name,status
     ) VALUES
     ($1,$2,$3,$4,$5,'in_review'),
     ($6,$7,$8,$9,$10,'pending')`,
    [
      ids.deliverableA,
      ids.projectA,
      ids.organizationA,
      ids.milestoneA,
      `${marker}_DELIVERABLE_A`,
      ids.deliverableB,
      ids.projectB,
      ids.organizationB,
      ids.milestoneB,
      `${marker}_DELIVERABLE_B`,
    ],
  );

  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: headers(clerkIds.clientA),
  });
  assertStatus(me, 200, "ME");
  assert(
    data<Identity>(me).organizations.map(({ id }) => id).join() ===
      ids.organizationA,
    "ME_ORGANIZATION_SCOPE",
  );

  const projects = await app.inject({
    method: "GET",
    url: `/api/v1/projects?organizationId=${ids.organizationA}`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(projects, 200, "PROJECT_LIST_A");
  const projectPage = data<Page<Project>>(projects);
  const visibleProjectIds = projectPage.items.map(({ id }) => id);
  assert(
    visibleProjectIds.length === 1 && visibleProjectIds[0] === ids.projectA,
    `PROJECT_LIST_SCOPE_${JSON.stringify(projectPage)}`,
  );
  const projectB = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${ids.projectB}`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(projectB, 404, "PROJECT_B_NEUTRAL");

  const milestones = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${ids.projectA}/milestones`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(milestones, 200, "MILESTONES_A");
  assert(
    data<Array<{ id: string }>>(milestones).map(({ id }) => id).join() ===
      ids.milestoneA,
    "MILESTONE_SCOPE",
  );
  const deliverables = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${ids.projectA}/deliverables`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(deliverables, 200, "DELIVERABLES_A");
  assert(
    data<Array<{ id: string }>>(deliverables).map(({ id }) => id).join() ===
      ids.deliverableA,
    "DELIVERABLE_SCOPE",
  );

  const standalone = await createTicket({
    type: "incident",
    requestedPriority: "high",
    subject: `${marker}_STANDALONE`,
    description: "Standalone portal smoke",
  });
  assert(
    standalone.organizationId === null &&
      standalone.projectId === null &&
      standalone.requesterUserId === ids.clientA &&
      standalone.requestedPriority === "high",
    "STANDALONE_CONTEXT",
  );
  const organizational = await createTicket({
    organizationId: ids.organizationA,
    type: "question",
    subject: `${marker}_ORGANIZATIONAL`,
    description: "Organization portal smoke",
  });
  assert(
    organizational.organizationId === ids.organizationA &&
      organizational.projectId === null,
    "ORGANIZATION_CONTEXT",
  );
  const project = await createTicket({
    projectId: ids.projectA,
    type: "bug",
    subject: `${marker}_PROJECT`,
    description: "Project portal smoke",
  });
  assert(
    project.organizationId === ids.organizationA &&
      project.projectId === ids.projectA,
    "PROJECT_CONTEXT",
  );
  const crossTenantCreate = await app.inject({
    method: "POST",
    url: "/api/v1/tickets",
    headers: headers(clerkIds.clientA),
    payload: {
      organizationId: ids.organizationB,
      projectId: ids.projectB,
      type: "bug",
      subject: `${marker}_CROSS_TENANT`,
      description: "Must fail",
    },
  });
  assert(
    [403, 404].includes(crossTenantCreate.statusCode),
    `CROSS_TENANT_CREATE_HTTP_${crossTenantCreate.statusCode}`,
  );

  const clientCommentResponse = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${organizational.id}/comments`,
    headers: headers(clerkIds.clientA),
    payload: { visibility: "client", content: `${marker}_CLIENT_COMMENT` },
  });
  assertStatus(clientCommentResponse, 201, "CLIENT_COMMENT_CREATE");
  commentIds.push(data<Comment>(clientCommentResponse).id);
  const internalCommentResponse = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${organizational.id}/comments`,
    headers: headers(clerkIds.admin),
    payload: { visibility: "internal", content: `${marker}_INTERNAL_COMMENT` },
  });
  assertStatus(internalCommentResponse, 201, "INTERNAL_COMMENT_CREATE");
  commentIds.push(data<Comment>(internalCommentResponse).id);
  const clientCommentsResponse = await app.inject({
    method: "GET",
    url: `/api/v1/tickets/${organizational.id}/comments`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(clientCommentsResponse, 200, "CLIENT_COMMENT_LIST");
  const clientComments = data<readonly Comment[]>(clientCommentsResponse);
  assert(
    clientComments.length === 1 &&
      clientComments.every(({ visibility }) => visibility === "client"),
    "INTERNAL_COMMENT_EXPOSED",
  );

  await pool.query(
    `UPDATE tickets SET status='resolved',resolution='Resolved by smoke',
       resolved_at=now(),updated_at=clock_timestamp()
     WHERE id=ANY($1::uuid[])`,
    [[organizational.id, project.id]],
  );
  const resolvedOrganization = data<Ticket>(
    await app.inject({
      method: "GET",
      url: `/api/v1/tickets/${organizational.id}`,
      headers: headers(clerkIds.clientA),
    }),
  );
  const confirm = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${organizational.id}/confirm`,
    headers: headers(clerkIds.clientA),
    payload: {
      decision: "confirm",
      expectedUpdatedAt: resolvedOrganization.updatedAt,
    },
  });
  assertStatus(confirm, 200, "CONFIRM_RESOLUTION");
  const closed = data<Ticket>(confirm);
  assert(closed.status === "closed", "CONFIRM_STATUS");
  const reopen = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${organizational.id}/reopen`,
    headers: headers(clerkIds.clientA),
    payload: {
      reason: `${marker}_REOPEN_REASON`,
      expectedUpdatedAt: closed.updatedAt,
    },
  });
  assertStatus(reopen, 200, "REOPEN");
  assert(data<Ticket>(reopen).status === "reopened", "REOPEN_STATUS");

  const resolvedProject = data<Ticket>(
    await app.inject({
      method: "GET",
      url: `/api/v1/tickets/${project.id}`,
      headers: headers(clerkIds.clientA),
    }),
  );
  const reject = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${project.id}/confirm`,
    headers: headers(clerkIds.clientA),
    payload: {
      decision: "reject",
      reason: `${marker}_REJECT_REASON`,
      expectedUpdatedAt: resolvedProject.updatedAt,
    },
  });
  assertStatus(reject, 200, "REJECT_RESOLUTION");
  assert(data<Ticket>(reject).status === "reopened", "REJECT_STATUS");

  await pool.query(
    `UPDATE tickets SET status='resolved',resolution='Conflict smoke',
       resolved_at=now(),updated_at=clock_timestamp() WHERE id=$1`,
    [standalone.id],
  );
  const stale = data<Ticket>(
    await app.inject({
      method: "GET",
      url: `/api/v1/tickets/${standalone.id}`,
      headers: headers(clerkIds.clientA),
    }),
  );
  await pool.query(
    "UPDATE tickets SET updated_at=clock_timestamp() + interval '1 second' WHERE id=$1",
    [standalone.id],
  );
  const conflict = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${standalone.id}/confirm`,
    headers: headers(clerkIds.clientA),
    payload: { decision: "confirm", expectedUpdatedAt: stale.updatedAt },
  });
  assertStatus(conflict, 409, "STALE_CONFIRM");

  smokeResult = {
    markerPrefix: "PHASE74_SMOKE_",
    organizations: 2,
    organizationIsolation: true,
    projects: true,
    milestones: true,
    deliverables: true,
    tickets: ["standalone", "organization", "project"],
    comments: { clientVisible: true, internalHidden: true },
    resolution: { confirm: true, reject: true, reopen: true, conflict: true },
  };
} catch (error) {
  smokeError = error;
} finally {
  await app.close().catch(() => undefined);
  await pool.query("BEGIN").catch(() => undefined);
  try {
    await pool.query(
      `DELETE FROM audit_events
       WHERE actor_user_id=ANY($1::uuid[])
          OR organization_id=ANY($2::uuid[])
          OR entity_id=ANY($3::uuid[])`,
      [userIds, organizationIds, [...projectIds, ...ticketIds, ...commentIds]],
    );
    await pool.query(
      "DELETE FROM ticket_comments WHERE ticket_id=ANY($1::uuid[]) OR author_user_id=ANY($2::uuid[])",
      [ticketIds, userIds],
    );
    await pool.query(
      "DELETE FROM tickets WHERE id=ANY($1::uuid[]) OR requester_user_id=ANY($2::uuid[])",
      [ticketIds, userIds],
    );
    await pool.query(
      "DELETE FROM deliverables WHERE project_id=ANY($1::uuid[])",
      [projectIds],
    );
    await pool.query(
      "DELETE FROM project_milestones WHERE project_id=ANY($1::uuid[])",
      [projectIds],
    );
    await pool.query(
      "DELETE FROM project_members WHERE project_id=ANY($1::uuid[])",
      [projectIds],
    );
    await pool.query("DELETE FROM projects WHERE id=ANY($1::uuid[])", [
      projectIds,
    ]);
    await pool.query(
      "DELETE FROM organization_memberships WHERE organization_id=ANY($1::uuid[])",
      [organizationIds],
    );
    await pool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [
      userIds,
    ]);
    await pool.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [
      organizationIds,
    ]);
    await pool.query("DELETE FROM app_users WHERE id=ANY($1::uuid[])", [
      userIds,
    ]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    cleanupError = error;
  }
}

const residual = await pool.query<{ readonly count: number }>(
  `SELECT (
     (SELECT count(*) FROM app_users WHERE clerk_user_id LIKE $1)
     + (SELECT count(*) FROM organizations WHERE id=ANY($2::uuid[]))
     + (SELECT count(*) FROM projects WHERE id=ANY($3::uuid[]))
     + (SELECT count(*) FROM project_milestones WHERE project_id=ANY($3::uuid[]))
     + (SELECT count(*) FROM deliverables WHERE project_id=ANY($3::uuid[]))
     + (SELECT count(*) FROM tickets WHERE requester_user_id=ANY($4::uuid[]))
     + (SELECT count(*) FROM ticket_comments WHERE author_user_id=ANY($4::uuid[]))
     + (SELECT count(*) FROM audit_events
        WHERE actor_user_id=ANY($4::uuid[]) OR organization_id=ANY($2::uuid[]))
   )::integer AS count`,
  [`${marker}%`, organizationIds, projectIds, userIds],
);
await pool.end();

const residualFixtures = residual.rows[0]?.count ?? -1;
if (cleanupError !== undefined) {
  throw new Error("PHASE74_SMOKE_CLEANUP_FAILED", { cause: cleanupError });
}
assert(residualFixtures === 0, `PHASE74_RESIDUAL_FIXTURES_${residualFixtures}`);
if (smokeError !== undefined) {
  throw new Error("PHASE74_SMOKE_FAILED", { cause: smokeError });
}
console.log(
  JSON.stringify(
    {
      ok: true,
      database: "GestionIlvox",
      schema: "public",
      ...smokeResult,
      residualFixtures,
    },
    null,
    2,
  ),
);
