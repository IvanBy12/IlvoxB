import { randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";

const PREFIX = "PHASE8D1_SMOKE_";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("PHASE8D1_SMOKE_REQUIRES_LOCAL_POSTGRESQL");

const marker = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
const ids = {
  owner: randomUUID(), pending: randomUUID(), blocked: randomUUID(), deleted: randomUUID(),
  client: randomUUID(), clientManager: randomUUID(), noneligible: randomUUID(), scoped: randomUUID(),
  organizationA: randomUUID(), organizationB: randomUUID(), projectA: randomUUID(), projectB: randomUUID(),
  taskA: randomUUID(), ticketA: randomUUID(), ticketB: randomUUID(), leadA: randomUUID(),
};
const clerk = { owner: `${marker}_owner`, client: `${marker}_client`, scoped: `${marker}_scoped` };
const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8d1-smoke" });
const authenticationProvider: AuthenticationProvider = {
  authenticate: (request) => {
    const value = request.headers["x-phase8d1-smoke-user"];
    return Promise.resolve(typeof value === "string" ? { clerkUserId: value } : null);
  },
};
const app = await buildApp({
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "3006", LOG_LEVEL: "silent", TRUST_PROXY: "false", CORS_ORIGINS: "http://localhost:5173", RATE_LIMIT_MAX: "1000" },
  logger: false,
  authenticationProvider,
});
type InjectResponse = { readonly statusCode: number; json<T>(): T };
type Candidate = { readonly id: string; readonly displayName: string; readonly email: string; readonly roles: readonly string[] };
const headers = (clerkUserId: string) => ({ "x-phase8d1-smoke-user": clerkUserId });
const data = <T>(response: InjectResponse): T => response.json<{ data: T }>().data;
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); }
function status(response: InjectResponse, expected: number, label: string): void {
  assert(response.statusCode === expected, `${label}_EXPECTED_${expected}_GOT_${response.statusCode}`);
}
async function eligible(purpose: string, context = "", actor = clerk.owner) {
  const response = await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=${purpose}${context}&search=${marker}`, headers: headers(actor) });
  status(response, 200, `ELIGIBLE_${purpose}`);
  return data<{ readonly items: Candidate[] }>(response).items;
}

async function cleanup() {
  await pool.query("BEGIN");
  try {
    const userIds = [ids.owner, ids.pending, ids.blocked, ids.deleted, ids.client, ids.clientManager, ids.noneligible, ids.scoped];
    await pool.query("DELETE FROM audit_events WHERE actor_user_id = ANY($1::uuid[]) OR organization_id = ANY($2::uuid[])", [userIds, [ids.organizationA, ids.organizationB]]);
    await pool.query("DELETE FROM tasks WHERE id = $1", [ids.taskA]);
    await pool.query("DELETE FROM tickets WHERE id = ANY($1::uuid[])", [[ids.ticketA, ids.ticketB]]);
    await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadA]);
    await pool.query("DELETE FROM project_members WHERE organization_id = ANY($1::uuid[])", [[ids.organizationA, ids.organizationB]]);
    await pool.query("DELETE FROM projects WHERE organization_id = ANY($1::uuid[])", [[ids.organizationA, ids.organizationB]]);
    await pool.query("DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [[ids.organizationA, ids.organizationB]]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[ids.organizationA, ids.organizationB]]);
    await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [userIds]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

let smokeError: unknown;
try {
  await cleanup();
  status(await app.inject({ method: "GET", url: "/health/live" }), 200, "HEALTH_LIVE");
  status(await app.inject({ method: "GET", url: "/health/ready" }), 200, "HEALTH_READY");
  status(await app.inject({ method: "GET", url: "/me" }), 401, "ME_WITHOUT_TOKEN");
  await pool.query(
    `INSERT INTO app_users (id, clerk_user_id, primary_email, first_name, status) VALUES
     ($1,$2,$3,'Owner','active'), ($4,$5,$6,'Pending','pending'),
     ($7,$8,$9,'Blocked','blocked'), ($10,$11,$12,'Deleted','deleted'),
     ($13,$14,$15,'Client','active'), ($16,$17,$18,'Client Manager','active')`,
    [
      ids.owner, clerk.owner, `${marker}_owner@example.test`,
      ids.pending, `${marker}_pending`, `${marker}_pending@example.test`,
      ids.blocked, `${marker}_blocked`, `${marker}_blocked@example.test`,
      ids.deleted, `${marker}_deleted`, `${marker}_deleted@example.test`,
      ids.client, clerk.client, `${marker}_client@example.test`,
      ids.clientManager, `${marker}_client_manager`, `${marker}_client_manager@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id, role_scope)
     SELECT fixture.user_id, r.id, 'global'
     FROM (VALUES ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid)) fixture(user_id)
     JOIN roles r ON r.scope = 'global' AND r.code = 'super_admin'`,
    [ids.owner, ids.pending, ids.blocked, ids.deleted],
  );
  await pool.query(
    `INSERT INTO organizations (id, name, status, account_manager_user_id) VALUES
     ($1,$2,'active',$5), ($3,$4,'active',$5)`,
    [ids.organizationA, `${marker}_ORG_A`, ids.organizationB, `${marker}_ORG_B`, ids.owner],
  );
  await pool.query(
    `INSERT INTO organization_memberships (organization_id,user_id,role_id,role_scope,status,activated_at)
     SELECT $1,$2,r.id,'organization','active',now() FROM roles r
     WHERE r.scope='organization' AND r.code='client_contact'`,
    [ids.organizationA, ids.client],
  );
  await pool.query(
    `INSERT INTO organization_memberships (organization_id,user_id,role_id,role_scope,status,activated_at)
     SELECT $1,$2,r.id,'organization','active',now() FROM roles r
     WHERE r.scope='organization' AND r.code='client_manager'`,
    [ids.organizationA, ids.clientManager],
  );
  await pool.query(
    `INSERT INTO projects (id,organization_id,name,description,status,priority,lead_user_id,start_date,due_date,created_by_user_id) VALUES
     ($1,$2,$3,'Smoke project A','planning','medium',$7,'2026-08-01','2026-10-31',$7),
     ($4,$5,$6,'Smoke project B','planning','medium',$7,'2026-08-01','2026-10-31',$7)`,
    [ids.projectA, ids.organizationA, `${marker}_PROJECT_A`, ids.projectB, ids.organizationB, `${marker}_PROJECT_B`, ids.owner],
  );
  await pool.query(
    `INSERT INTO project_members (project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id)
     SELECT $1,$2,$3,r.id,'project',$4 FROM roles r WHERE r.scope='project' AND r.code='project_member'`,
    [ids.projectA, ids.organizationA, ids.client, ids.owner],
  );
  await pool.query(
    `INSERT INTO tasks (id,organization_id,project_id,title,description,assigned_to_user_id,created_by_user_id,priority,status,due_date)
     VALUES ($1,$2,$3,$4,'Smoke task',$5,$5,'medium','pending','2026-09-01')`,
    [ids.taskA, ids.organizationA, ids.projectA, `${marker}_TASK`, ids.owner],
  );
  await pool.query(
    `INSERT INTO tickets (id,organization_id,project_id,requester_user_id,type,requested_priority,priority,status,subject,description) VALUES
     ($1,$2,$3,$4,'question','medium','medium','new',$5,'Smoke ticket A'),
     ($6,$7,$8,$4,'question','medium','medium','new',$9,'Smoke ticket B')`,
    [ids.ticketA, ids.organizationA, ids.projectA, ids.client, `${marker}_TICKET_A`, ids.ticketB, ids.organizationB, ids.projectB, `${marker}_TICKET_B`],
  );
  await pool.query(
    `INSERT INTO leads (id,full_name,email,message,source,status,assigned_to_user_id)
     VALUES ($1,$2,$3,'Smoke lead','contact','new',$4)`,
    [ids.leadA, `${marker}_LEAD`, `${marker}_lead@example.test`, ids.owner],
  );

  const membershipPreflight = await app.inject({
    method: "OPTIONS",
    url: `/api/v1/organizations/${ids.organizationA}/members/${ids.client}`,
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  status(membershipPreflight, 204, "MEMBERSHIP_PATCH_PREFLIGHT");
  assert(String(membershipPreflight.headers["access-control-allow-methods"]).includes("PATCH"), "MEMBERSHIP_PATCH_CORS_METHOD_MISSING");
  const membershipPatch = await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${ids.organizationA}/members/${ids.client}`,
    headers: { ...headers(clerk.owner), origin: "http://localhost:5173" },
    payload: {
      roleCode: "client_manager",
      status: "pending",
      jobTitle: "Gerente de operaciones",
      phone: "+57 300 000 0000",
    },
  });
  status(membershipPatch, 200, "MEMBERSHIP_PATCH");
  assert(data<{ readonly roleCode: string; readonly status: string; readonly jobTitle: string; readonly phone: string }>(membershipPatch).roleCode === "client_manager", "MEMBERSHIP_ROLE_NOT_UPDATED");
  assert(data<{ readonly status: string }>(membershipPatch).status === "pending", "MEMBERSHIP_STATUS_NOT_UPDATED");
  assert(data<{ readonly jobTitle: string }>(membershipPatch).jobTitle === "Gerente de operaciones", "MEMBERSHIP_JOB_TITLE_NOT_UPDATED");
  assert(data<{ readonly phone: string }>(membershipPatch).phone === "+57 300 000 0000", "MEMBERSHIP_PHONE_NOT_UPDATED");
  status(await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${ids.organizationA}/members/${ids.client}`,
    headers: headers(clerk.owner),
    payload: { roleCode: "client_contact", status: "active" },
  }), 200, "MEMBERSHIP_RESTORE_CLIENT_CONTACT");

  const catalog = await app.inject({ method: "GET", url: `/api/v1/users?search=${marker}&status=active&type=internal&role=super_admin&page=1&pageSize=20`, headers: headers(clerk.owner) });
  status(catalog, 200, "CATALOG");
  const catalogItems = data<{ readonly items: readonly { readonly id: string; readonly clerkUserId?: string }[] }>(catalog).items;
  assert(catalogItems.length === 1 && catalogItems[0]?.id === ids.owner && catalogItems[0].clerkUserId === undefined, "CATALOG_FILTER_OR_CLERK_LEAK");

  const accountManagers = await eligible("organization_account_manager", `&organizationId=${ids.organizationA}`);
  const projectLeads = await eligible("project_lead", `&projectId=${ids.projectA}`);
  const projectLeadsForCreate = await eligible("project_lead", `&organizationId=${ids.organizationA}`);
  const projectMembers = await eligible("project_member", `&projectId=${ids.projectA}`);
  const taskAssignees = await eligible("task_assignee", `&taskId=${ids.taskA}`);
  const ticketAssignees = await eligible("ticket_assignee", `&ticketId=${ids.ticketA}`);
  const leadAssignees = await eligible("lead_assignee", `&leadId=${ids.leadA}`);
  for (const [label, items] of Object.entries({ accountManagers, projectLeads, projectLeadsForCreate, projectMembers, taskAssignees, ticketAssignees, leadAssignees })) {
    assert(items.some((item) => item.id === ids.owner), `${label}_OWNER_MISSING`);
    assert(!items.some((item) => item.id === ids.pending), `${label}_PENDING_INCLUDED`);
    assert(!items.some((item) => item.id === ids.blocked), `${label}_BLOCKED_INCLUDED`);
    assert(!items.some((item) => item.id === ids.deleted), `${label}_DELETED_INCLUDED`);
  }
  assert(!ticketAssignees.some((item) => item.id === ids.client), "TICKET_CLIENT_INCLUDED");
  assert(!leadAssignees.some((item) => item.id === ids.client), "LEAD_CLIENT_INCLUDED");
  for (const [label, items] of Object.entries({ accountManagers, projectLeads, projectLeadsForCreate, taskAssignees, ticketAssignees, leadAssignees })) {
    assert(!items.some((item) => item.id === ids.client), `${label}_CLIENT_CONTACT_INCLUDED`);
    assert(!items.some((item) => item.id === ids.clientManager), `${label}_CLIENT_MANAGER_INCLUDED`);
  }

  const organizationAssignment = await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${ids.organizationA}`,
    headers: headers(clerk.owner),
    payload: { accountManagerUserId: ids.owner },
  });
  status(organizationAssignment, 200, "SELF_ASSIGN_ORGANIZATION");

  const projectCreation = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: headers(clerk.owner),
    payload: {
      organizationId: ids.organizationA,
      name: `${marker}_SELF_ASSIGNED_PROJECT`,
      description: "Created by the only active super admin",
      priority: "medium",
      leadUserId: ids.owner,
      startDate: "2026-08-27",
      dueDate: "2026-12-31",
    },
  });
  status(projectCreation, 201, "SELF_ASSIGN_PROJECT_LEAD");
  assert(data<{ readonly leadUserId: string }>(projectCreation).leadUserId === ids.owner, "PROJECT_LEAD_NOT_SELF");

  const ticketBefore = data<{ readonly updatedAt: string }>(await app.inject({
    method: "GET", url: `/api/v1/tickets/${ids.ticketA}`, headers: headers(clerk.owner),
  }));
  const ticketAssignment = await app.inject({
    method: "POST",
    url: `/api/v1/tickets/${ids.ticketA}/assign`,
    headers: headers(clerk.owner),
    payload: { assignedToUserId: ids.owner, expectedUpdatedAt: ticketBefore.updatedAt },
  });
  status(ticketAssignment, 200, "SELF_ASSIGN_TICKET");
  assert(data<{ readonly assignedToUserId: string }>(ticketAssignment).assignedToUserId === ids.owner, "TICKET_ASSIGNEE_NOT_SELF");

  const taskAssignment = await app.inject({
    method: "POST",
    url: `/api/v1/tasks/${ids.taskA}/assign`,
    headers: headers(clerk.owner),
    payload: { assignedToUserId: ids.owner },
  });
  status(taskAssignment, 200, "SELF_ASSIGN_TASK");

  for (const [label, userId] of [["CLIENT_CONTACT", ids.client], ["CLIENT_MANAGER", ids.clientManager]] as const) {
    const rejectedTaskAssignment = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${ids.taskA}/assign`,
      headers: headers(clerk.owner),
      payload: { assignedToUserId: userId },
    });
    status(rejectedTaskAssignment, 400, `TASK_ASSIGN_${label}`);
  }

  const leadAssignment = await app.inject({
    method: "POST",
    url: `/api/v1/leads/${ids.leadA}/assign`,
    headers: headers(clerk.owner),
    payload: { assignedToUserId: ids.owner },
  });
  status(leadAssignment, 200, "SELF_ASSIGN_LEAD");
  status(await app.inject({ method: "GET", url: "/api/v1/users", headers: headers(clerk.client) }), 403, "CLIENT_CATALOG");
  status(await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=ticket_assignee&ticketId=${ids.ticketA}`, headers: headers(clerk.client) }), 403, "CLIENT_ELIGIBILITY");
  status(await app.inject({ method: "GET", url: "/api/v1/users/eligible?purpose=invalid", headers: headers(clerk.owner) }), 400, "INVALID_PURPOSE");

  await pool.query(
    "INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status) VALUES ($1,$2,$3,'Noneligible','active')",
    [ids.noneligible, `${marker}_noneligible`, `${marker}_noneligible@example.test`],
  );
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id,role_scope) SELECT $1,r.id,'global' FROM roles r WHERE r.scope='global' AND r.code='contributor'",
    [ids.noneligible],
  );
  for (const [purpose, context] of [
    ["organization_account_manager", `&organizationId=${ids.organizationA}`],
    ["project_lead", `&projectId=${ids.projectA}`],
    ["ticket_assignee", `&ticketId=${ids.ticketA}`],
    ["lead_assignee", `&leadId=${ids.leadA}`],
  ] as const) {
    assert(!(await eligible(purpose, context)).some((item) => item.id === ids.noneligible), `${purpose}_NONELIGIBLE_INCLUDED`);
  }

  await pool.query("INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status) VALUES ($1,$2,$3,'Scoped','active')", [ids.scoped, clerk.scoped, `${marker}_scoped@example.test`]);
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope) SELECT $1,r.id,'global' FROM roles r WHERE r.scope='global' AND r.code='project_lead'`,
    [ids.scoped],
  );
  await pool.query(
    `INSERT INTO project_members (project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id)
     SELECT $1,$2,$3,r.id,'project',$4 FROM roles r WHERE r.scope='project' AND r.code='project_lead'`,
    [ids.projectA, ids.organizationA, ids.scoped, ids.owner],
  );
  const crossScope = await app.inject({ method: "GET", url: `/api/v1/users/eligible?purpose=ticket_assignee&ticketId=${ids.ticketB}`, headers: headers(clerk.scoped) });
  status(crossScope, 404, "CROSS_SCOPE");

  console.log(JSON.stringify({
    marker,
    singleInternalSuperAdmin: true,
    corsMembershipPatch: true,
    membershipFieldsPersisted: true,
    accountManager: true,
    projectLead: true,
    projectMember: true,
    taskAssignee: true,
    ticketAssignee: true,
    leadAssignee: true,
    selfAssignments: { organization: true, project: true, ticket: true, task: true, lead: true },
    clientExcluded: true,
    clientManagerExcluded: true,
    inactiveExcluded: true,
    blockedAndDeletedExcluded: true,
    noneligibleExcluded: true,
    crossScope: 404,
    healthLive: 200,
    healthReady: 200,
    meWithoutToken: 401,
  }));
} catch (error) {
  smokeError = error;
} finally {
  await cleanup().catch((error) => { if (smokeError === undefined) smokeError = error; });
  const residual = await pool.query<{ readonly total: number }>(
    `SELECT ((SELECT count(*) FROM app_users WHERE primary_email LIKE $1) +
             (SELECT count(*) FROM organizations WHERE name LIKE $1) +
             (SELECT count(*) FROM projects WHERE name LIKE $1) +
             (SELECT count(*) FROM tasks WHERE title LIKE $1) +
             (SELECT count(*) FROM tickets WHERE subject LIKE $1) +
             (SELECT count(*) FROM leads WHERE full_name LIKE $1))::int AS total`,
    [`${PREFIX}%`],
  ).catch(() => ({ rows: [{ total: -1 }] }));
  console.log(JSON.stringify({ residualFixtures: residual.rows[0]?.total ?? -1 }));
  await app.close();
  await pool.end();
}
if (smokeError !== undefined) throw smokeError instanceof Error ? smokeError : new Error("PHASE8D1_SMOKE_FAILED", { cause: smokeError });
