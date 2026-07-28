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
const marker = `phase6_operational_${suffix}`;
const ids = {
  admin: randomUUID(),
  requester: randomUUID(),
  other: randomUUID(),
  support: randomUUID(),
  organization: randomUUID(),
  project: randomUUID(),
};
const clerkIds = {
  admin: `${marker}_admin`,
  requester: `${marker}_requester`,
  other: `${marker}_other`,
  support: `${marker}_support`,
};
const userIds = [ids.admin, ids.requester, ids.other, ids.support];
const pool = new Pool({ connectionString, max: 12 });
const auth: AuthenticationProvider = {
  authenticate: (request) => {
    const value = request.headers["x-phase6-smoke-user"];
    return Promise.resolve(typeof value === "string" ? { clerkUserId: value } : null);
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
  authenticationProvider: auth,
});

const headers = (clerkUserId: string) => ({ "x-phase6-smoke-user": clerkUserId });
const json = <T>(response: { json<TValue>(): TValue }): T => response.json<T>();
const data = <T>(response: { json<TValue>(): TValue }): T =>
  json<{ data: T }>(response).data;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const assertStatus = (
  response: { statusCode: number },
  expected: number,
  label: string,
): void => assert(response.statusCode === expected, `${label}_HTTP_${response.statusCode}`);

type Ticket = {
  id: string;
  code: string;
  organizationId: string | null;
  projectId: string | null;
  requesterUserId: string;
  assignedToUserId: string | null;
  status: string;
  priority: string;
  updatedAt: string;
};
type Comment = {
  id: string;
  ticketId: string;
  organizationId: string | null;
  authorUserId: string;
  visibility: string;
  content: string;
};

const ticketIds: string[] = [];
const commentIds: string[] = [];
let smokeResult: Record<string, unknown> | undefined;
let smokeError: unknown;
let cleanupError: unknown;

try {
  await pool.query(
    `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
     ($1,$2,$3,'active'),($4,$5,$6,'active'),
     ($7,$8,$9,'active'),($10,$11,$12,'active')`,
    [
      ids.admin, clerkIds.admin, `${marker}-admin@example.test`,
      ids.requester, clerkIds.requester, `${marker}-requester@example.test`,
      ids.other, clerkIds.other, `${marker}-other@example.test`,
      ids.support, clerkIds.support, `${marker}-support@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope)
     SELECT fixture.user_id,r.id,'global'
     FROM (VALUES ($1::uuid,'admin'),($2::uuid,'support_agent'))
       fixture(user_id,role_code)
     JOIN roles r ON r.scope='global' AND r.code=fixture.role_code`,
    [ids.admin, ids.support],
  );
  await pool.query(
    `INSERT INTO organizations (id,name,status)
     VALUES ($1,$2,'active')`,
    [ids.organization, `Phase 6 operational ${suffix}`],
  );
  await pool.query(
    `INSERT INTO organization_memberships (
       organization_id,user_id,role_id,role_scope,status,activated_at
     )
     SELECT $1,$2,r.id,'organization','active',now()
     FROM roles r WHERE r.scope='organization' AND r.code='client_contact'`,
    [ids.organization, ids.requester],
  );
  await pool.query(
    `INSERT INTO projects (
       id,organization_id,name,description,status,priority,lead_user_id,
       start_date,due_date,created_by_user_id
     ) VALUES ($1,$2,$3,'Phase 6 operational smoke','planning','medium',$4,
       '2026-07-01','2026-09-30',$4)`,
    [ids.project, ids.organization, `Phase 6 project ${suffix}`, ids.admin],
  );
  await pool.query(
    `INSERT INTO project_members (
       project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id
     )
     SELECT $1,$2,$3,r.id,'project',$4
     FROM roles r WHERE r.scope='project' AND r.code='project_member'`,
    [ids.project, ids.organization, ids.requester, ids.admin],
  );

  const create = async (
    clerkUserId: string,
    payload: Record<string, unknown>,
    label: string,
  ): Promise<Ticket> => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets",
      headers: headers(clerkUserId),
      payload,
    });
    assertStatus(response, 201, label);
    const ticket = data<Ticket>(response);
    ticketIds.push(ticket.id);
    return ticket;
  };

  const standalone = await create(clerkIds.requester, {
    type: "incident",
    requestedPriority: "high",
    subject: `${marker} standalone`,
    description: "Standalone operational smoke",
  }, "STANDALONE_CREATE");
  assert(standalone.organizationId === null && standalone.projectId === null,
    "STANDALONE_CONTEXT_MISMATCH");
  assert(standalone.requesterUserId === ids.requester, "STANDALONE_REQUESTER_MISMATCH");

  const otherStandalone = await create(clerkIds.other, {
    type: "question",
    subject: `${marker} other private`,
    description: "Other individual private ticket",
  }, "OTHER_STANDALONE_CREATE");
  const isolatedGet = await app.inject({
    method: "GET",
    url: `/api/v1/tickets/${otherStandalone.id}`,
    headers: headers(clerkIds.requester),
  });
  assertStatus(isolatedGet, 404, "INDIVIDUAL_ISOLATION_GET");
  const isolatedList = await app.inject({
    method: "GET",
    url: `/api/v1/tickets?search=${encodeURIComponent(`${marker} other private`)}`,
    headers: headers(clerkIds.requester),
  });
  assertStatus(isolatedList, 200, "INDIVIDUAL_ISOLATION_LIST");
  assert(data<{ items: Ticket[] }>(isolatedList).items.length === 0,
    "INDIVIDUAL_ISOLATION_LIST_LEAK");

  const organizational = await create(clerkIds.requester, {
    organizationId: ids.organization,
    type: "service_request",
    subject: `${marker} organizational`,
    description: "Organizational operational smoke",
  }, "ORGANIZATIONAL_CREATE");
  assert(organizational.organizationId === ids.organization && organizational.projectId === null,
    "ORGANIZATIONAL_CONTEXT_MISMATCH");

  const project = await create(clerkIds.requester, {
    projectId: ids.project,
    type: "bug",
    subject: `${marker} project`,
    description: "Project operational smoke",
  }, "PROJECT_CREATE");
  assert(project.organizationId === ids.organization && project.projectId === ids.project,
    "PROJECT_CONTEXT_MISMATCH");

  const clientCommentResponse = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${otherStandalone.id}/comments`,
    headers: headers(clerkIds.other),
    payload: { visibility: "client", content: "Client smoke details" },
  });
  assertStatus(clientCommentResponse, 201, "CLIENT_COMMENT_CREATE");
  const clientComment = data<Comment>(clientCommentResponse);
  commentIds.push(clientComment.id);
  assert(clientComment.organizationId === null, "CLIENT_COMMENT_ORGANIZATION_NOT_DERIVED");

  const internalCommentResponse = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${otherStandalone.id}/comments`,
    headers: headers(clerkIds.support),
    payload: { visibility: "internal", content: "Internal smoke details" },
  });
  assertStatus(internalCommentResponse, 201, "INTERNAL_COMMENT_CREATE");
  const internalComment = data<Comment>(internalCommentResponse);
  commentIds.push(internalComment.id);

  const individualComments = await app.inject({
    method: "GET",
    url: `/api/v1/tickets/${otherStandalone.id}/comments`,
    headers: headers(clerkIds.other),
  });
  assertStatus(individualComments, 200, "INDIVIDUAL_COMMENT_LIST");
  assert(data<Comment[]>(individualComments).map((item) => item.visibility).join(",") === "client",
    "INTERNAL_COMMENT_LEAK");
  const supportComments = await app.inject({
    method: "GET",
    url: `/api/v1/tickets/${otherStandalone.id}/comments`,
    headers: headers(clerkIds.support),
  });
  assertStatus(supportComments, 200, "SUPPORT_COMMENT_LIST");
  assert(data<Comment[]>(supportComments).length === 2, "SUPPORT_COMMENT_LIST_MISMATCH");

  const assign = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${standalone.id}/assign`,
    headers: headers(clerkIds.admin),
    payload: { assignedToUserId: ids.support, expectedUpdatedAt: standalone.updatedAt },
  });
  assertStatus(assign, 200, "FLOW_ASSIGN");
  let flow = data<Ticket>(assign);

  const priority = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${standalone.id}/priority`,
    headers: headers(clerkIds.admin),
    payload: { priority: "urgent", expectedUpdatedAt: flow.updatedAt },
  });
  assertStatus(priority, 200, "FLOW_PRIORITY");
  flow = data<Ticket>(priority);
  assert(flow.priority === "urgent", "FLOW_PRIORITY_MISMATCH");

  for (const [status, clerkUserId, extra] of [
    ["classifying", clerkIds.admin, {}],
    ["assigned", clerkIds.admin, {}],
    ["in_progress", clerkIds.support, {}],
    ["pending_client", clerkIds.support, {}],
    ["in_progress", clerkIds.support, {}],
    ["resolved", clerkIds.support, { resolution: "Operational smoke resolved" }],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${standalone.id}/transition`,
      headers: headers(clerkUserId),
      payload: { status, expectedUpdatedAt: flow.updatedAt, ...extra },
    });
    assertStatus(response, 200, `FLOW_TRANSITION_${status.toUpperCase()}`);
    flow = data<Ticket>(response);
    assert(flow.status === status, `FLOW_STATUS_${status.toUpperCase()}_MISMATCH`);
  }

  const confirm = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${standalone.id}/confirm`,
    headers: headers(clerkIds.requester),
    payload: { decision: "confirm", expectedUpdatedAt: flow.updatedAt },
  });
  assertStatus(confirm, 200, "FLOW_CONFIRM");
  flow = data<Ticket>(confirm);
  assert(flow.status === "closed", "FLOW_NOT_CLOSED");

  for (const ticket of [organizational, project]) {
    const beforeRevoke = await app.inject({
      method: "GET",
      url: `/api/v1/tickets/${ticket.id}`,
      headers: headers(clerkIds.requester),
    });
    assertStatus(beforeRevoke, 200, "REVOCATION_ACCESS_BEFORE");
  }
  await pool.query(
    `UPDATE organization_memberships
     SET status='revoked',revoked_at=now(),updated_at=now()
     WHERE organization_id=$1 AND user_id=$2`,
    [ids.organization, ids.requester],
  );
  await pool.query(
    `UPDATE project_members
     SET status='revoked',revoked_at=now(),revoked_by_user_id=$1,updated_at=now()
     WHERE project_id=$2 AND user_id=$3`,
    [ids.admin, ids.project, ids.requester],
  );
  for (const ticket of [organizational, project]) {
    const afterRevoke = await app.inject({
      method: "GET",
      url: `/api/v1/tickets/${ticket.id}`,
      headers: headers(clerkIds.requester),
    });
    assertStatus(afterRevoke, 404, "REVOCATION_ACCESS_AFTER");
  }

  const concurrent = await create(clerkIds.other, {
    type: "incident",
    subject: `${marker} concurrency`,
    description: "Optimistic concurrency operational smoke",
  }, "CONCURRENCY_CREATE");
  const concurrencyResponses = await Promise.all([
    app.inject({
      method: "POST",
      url: `/api/v1/tickets/${concurrent.id}/assign`,
      headers: headers(clerkIds.admin),
      payload: { assignedToUserId: ids.support, expectedUpdatedAt: concurrent.updatedAt },
    }),
    app.inject({
      method: "POST",
      url: `/api/v1/tickets/${concurrent.id}/assign`,
      headers: headers(clerkIds.admin),
      payload: { assignedToUserId: ids.admin, expectedUpdatedAt: concurrent.updatedAt },
    }),
  ]);
  const concurrencyStatuses = concurrencyResponses
    .map((response) => response.statusCode)
    .sort((left, right) => left - right);
  assert(concurrencyStatuses.join(",") === "200,409", "CONCURRENCY_RESULT_MISMATCH");

  const codes = [standalone, otherStandalone, organizational, project, concurrent]
    .map((ticket) => ticket.code);
  assert(new Set(codes).size === codes.length, "TICKET_CODE_COLLISION");
  const commentAudit = await pool.query<{ content_present: boolean }>(
    `SELECT new_values ? 'content' AS content_present
     FROM audit_events
     WHERE action='ticket_comment.created' AND entity_id=ANY($1::uuid[])`,
    [commentIds],
  );
  assert(commentAudit.rows.length === 2, "COMMENT_AUDIT_COUNT_MISMATCH");
  assert(commentAudit.rows.every((row) => !row.content_present), "COMMENT_CONTENT_IN_AUDIT");

  smokeResult = {
    ticketStandalone: true,
    individualIsolation: true,
    organizationalTicket: true,
    projectTicket: true,
    comments: {
      client: true,
      internalFiltered: true,
      organizationDerived: true,
      auditContentOmitted: true,
    },
    revocations: true,
    completeFlow: {
      statuses: [
        "new", "classifying", "assigned", "in_progress",
        "pending_client", "in_progress", "resolved", "closed",
      ],
      priorityChanged: true,
      requesterConfirmed: true,
    },
    concurrency: { statuses: concurrencyStatuses },
    uniqueCodes: true,
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
          OR entity_id=ANY($2::uuid[])
          OR organization_id=$3`,
      [userIds, [...ticketIds, ...commentIds], ids.organization],
    );
    await pool.query(
      `DELETE FROM ticket_comments
       WHERE ticket_id=ANY($1::uuid[]) OR author_user_id=ANY($2::uuid[])`,
      [ticketIds, userIds],
    );
    await pool.query(
      `DELETE FROM tickets
       WHERE id=ANY($1::uuid[]) OR requester_user_id=ANY($2::uuid[])`,
      [ticketIds, userIds],
    );
    await pool.query("DELETE FROM project_members WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM projects WHERE organization_id=$1", [ids.organization]);
    await pool.query(
      "DELETE FROM organization_memberships WHERE organization_id=$1",
      [ids.organization],
    );
    await pool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM organizations WHERE id=$1", [ids.organization]);
    await pool.query("DELETE FROM app_users WHERE id=ANY($1::uuid[])", [userIds]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    cleanupError = error;
  }
}

const residual = await pool.query<{ count: number }>(
  `SELECT (
     (SELECT count(*) FROM app_users WHERE clerk_user_id LIKE $1)
     + (SELECT count(*) FROM organizations WHERE id=$2)
     + (SELECT count(*) FROM projects WHERE organization_id=$2)
     + (SELECT count(*) FROM organization_memberships WHERE organization_id=$2)
     + (SELECT count(*) FROM project_members WHERE organization_id=$2)
     + (SELECT count(*) FROM tickets WHERE requester_user_id=ANY($3::uuid[]))
     + (SELECT count(*) FROM ticket_comments WHERE author_user_id=ANY($3::uuid[]))
     + (SELECT count(*) FROM audit_events
        WHERE actor_user_id=ANY($3::uuid[]) OR organization_id=$2)
   )::integer AS count`,
  [`${marker}%`, ids.organization, userIds],
);
await pool.end();
const residualFixtures = residual.rows[0]?.count ?? -1;
if (cleanupError !== undefined) {
  throw new Error("PHASE6_OPERATIONAL_CLEANUP_FAILED", { cause: cleanupError });
}
assert(residualFixtures === 0, `RESIDUAL_FIXTURES_${residualFixtures}`);
if (smokeError !== undefined) {
  throw new Error("PHASE6_OPERATIONAL_SMOKE_FAILED", { cause: smokeError });
}
console.log(JSON.stringify({
  ok: true,
  database: "GestionIlvox",
  schema: "public",
  ...smokeResult,
  residualFixtures,
}, null, 2));
