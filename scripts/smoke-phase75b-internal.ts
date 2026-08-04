import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_MISSING");
const marker = `PHASE75B_SMOKE_${randomUUID().replaceAll("-", "")}`;
const ids = { admin: randomUUID(), clientA: randomUUID(), organizationA: randomUUID(), organizationB: randomUUID() };
const clerkIds = { admin: `${marker}_admin`, clientA: `${marker}_client_a` };
const pool = new Pool({ connectionString, max: 8 });
const authenticationProvider: AuthenticationProvider = { authenticate: (request) => { const value = request.headers["x-phase75b-smoke-user"]; return Promise.resolve(typeof value === "string" ? { clerkUserId: value } : null); } };
const app = await buildApp({ env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "3004", LOG_LEVEL: "silent", TRUST_PROXY: "false", CORS_ORIGINS: "http://localhost:5173", RATE_LIMIT_MAX: "1000" }, logger: false, authenticationProvider });
type Response = { readonly statusCode: number; json<T>(): T };
type Project = { readonly id: string; readonly status: string; readonly updatedAt: string };
type Member = { readonly userId: string; readonly status: string; readonly updatedAt: string };
type Milestone = { readonly id: string; readonly status: string; readonly updatedAt: string };
type Deliverable = { readonly id: string; readonly status: string; readonly updatedAt: string };
type Task = { readonly id: string; readonly status: string; readonly updatedAt: string; readonly estimatedMinutes: number | null; readonly assignedToUserId: string };
const headers = (user: string) => ({ "x-phase75b-smoke-user": user });
const data = <T>(response: Response): T => response.json<{ data: T }>().data;
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); }
function status(response: Response, expected: number, label: string) { assert(response.statusCode === expected, `${label}_EXPECTED_${expected}_GOT_${response.statusCode}`); }
const projectIds: string[] = [], milestoneIds: string[] = [], deliverableIds: string[] = [], taskIds: string[] = [];
let smokeError: unknown, cleanupError: unknown, result: Record<string, unknown> | undefined;
try {
  await pool.query(`INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`, [ids.admin, clerkIds.admin, `${marker}_admin@example.test`, ids.clientA, clerkIds.clientA, `${marker}_client@example.test`]);
  await pool.query(`INSERT INTO user_roles (user_id,role_id,role_scope) SELECT $1,r.id,'global' FROM roles r WHERE r.scope='global' AND r.code='super_admin'`, [ids.admin]);
  await pool.query(`INSERT INTO organizations (id,name,status) VALUES ($1,$2,'active'),($3,$4,'active')`, [ids.organizationA, `${marker}_ORG_A`, ids.organizationB, `${marker}_ORG_B`]);
  await pool.query(`INSERT INTO organization_memberships (organization_id,user_id,role_id,role_scope,status,activated_at) SELECT $1,$2,r.id,'organization','active',now() FROM roles r WHERE r.scope='organization' AND r.code='client_contact'`, [ids.organizationA, ids.clientA]);
  const createProject = async (organizationId: string, label: string) => {
    const response = await app.inject({ method: "POST", url: "/api/v1/projects", headers: headers(clerkIds.admin), payload: { organizationId, name: `${marker}_${label}`, description: "Controlled Phase 7.5B project", priority: "medium", leadUserId: ids.admin, startDate: "2026-08-01", dueDate: "2026-10-31" } });
    status(response, 201, `PROJECT_CREATE_${label}`); const project = data<Project>(response); projectIds.push(project.id); return project;
  };
  let projectA = await createProject(ids.organizationA, "PROJECT_A");
  const projectB = await createProject(ids.organizationB, "PROJECT_B");
  await pool.query(`INSERT INTO project_members (project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id) SELECT fixture.project_id,fixture.organization_id,fixture.user_id,r.id,'project',$1 FROM (VALUES ($2::uuid,$3::uuid,$1::uuid),($4::uuid,$5::uuid,$1::uuid),($2::uuid,$3::uuid,$6::uuid)) fixture(project_id,organization_id,user_id) JOIN roles r ON r.scope='project' AND r.code=CASE WHEN fixture.user_id=$1 THEN 'project_lead' ELSE 'project_viewer' END`, [ids.admin, projectA.id, ids.organizationA, projectB.id, ids.organizationB, ids.clientA]);
  const list = await app.inject({ method: "GET", url: `/api/v1/projects?page=1&pageSize=1&search=${marker}&sortBy=name&sortDirection=asc`, headers: headers(clerkIds.admin) }); status(list, 200, "PROJECT_LIST");
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectA.id}`, headers: headers(clerkIds.admin) }), 200, "PROJECT_DETAIL");
  const staleProjectVersion = projectA.updatedAt;
  const editProject = await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}`, headers: headers(clerkIds.admin), payload: { name: `${marker}_PROJECT_A_EDITED`, expectedUpdatedAt: staleProjectVersion } }); status(editProject, 200, "PROJECT_EDIT"); projectA = data<Project>(editProject);
  status(await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}`, headers: headers(clerkIds.admin), payload: { priority: "high", expectedUpdatedAt: staleProjectVersion } }), 409, "PROJECT_CONFLICT");
  status(await app.inject({ method: "POST", url: `/api/v1/projects/${projectA.id}/transition`, headers: headers(clerkIds.admin), payload: { status: "delivered" } }), 409, "PROJECT_INVALID_TRANSITION");
  const started = await app.inject({ method: "POST", url: `/api/v1/projects/${projectA.id}/transition`, headers: headers(clerkIds.admin), payload: { status: "in_progress" } }); status(started, 200, "PROJECT_TRANSITION");
  const members = await app.inject({ method: "GET", url: `/api/v1/projects/${projectA.id}/members`, headers: headers(clerkIds.admin) }); status(members, 200, "MEMBERS_LIST");
  let clientMember = data<readonly Member[]>(members).find((item) => item.userId === ids.clientA)!; assert(clientMember !== undefined, "CLIENT_MEMBER_MISSING");
  const memberEdit = await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}/members/${ids.clientA}`, headers: headers(clerkIds.admin), payload: { roleCode: "project_member", expectedUpdatedAt: clientMember.updatedAt } }); status(memberEdit, 200, "MEMBER_EDIT"); clientMember = data<Member>(memberEdit);
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectA.id}`, headers: headers(clerkIds.clientA) }), 200, "OWN_PROJECT");
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectB.id}`, headers: headers(clerkIds.clientA) }), 404, "PROJECT_CROSS_TENANT");
  status(await app.inject({ method: "POST", url: "/api/v1/projects", headers: headers(clerkIds.clientA), payload: { organizationId: ids.organizationB, name: `${marker}_FORBIDDEN_PROJECT`, description: "Forbidden", leadUserId: ids.clientA, startDate: "2026-08-01", dueDate: "2026-10-31" } }), 403, "PROJECT_CROSS_TENANT_WRITE");
  status(await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}`, headers: headers(clerkIds.clientA), payload: { name: "forbidden" } }), 403, "PROJECT_READ_ONLY_MANAGE_DENIED");
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectB.id}/members`, headers: headers(clerkIds.clientA) }), 404, "MEMBERS_WRONG_PROJECT");
  const milestoneCreate = await app.inject({ method: "POST", url: `/api/v1/projects/${projectA.id}/milestones`, headers: headers(clerkIds.admin), payload: { name: `${marker}_MILESTONE`, description: "Controlled", dueDate: "2026-09-01" } }); status(milestoneCreate, 201, "MILESTONE_CREATE"); let milestone = data<Milestone>(milestoneCreate); milestoneIds.push(milestone.id);
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectA.id}/milestones/${milestone.id}`, headers: headers(clerkIds.admin) }), 200, "MILESTONE_DETAIL");
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectB.id}/milestones/${milestone.id}`, headers: headers(clerkIds.admin) }), 404, "MILESTONE_WRONG_PROJECT");
  const milestoneEdit = await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}/milestones/${milestone.id}`, headers: headers(clerkIds.admin), payload: { status: "completed", expectedUpdatedAt: milestone.updatedAt } }); status(milestoneEdit, 200, "MILESTONE_COMPLETE"); milestone = data<Milestone>(milestoneEdit);
  status(await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}/milestones/${milestone.id}`, headers: headers(clerkIds.admin), payload: { name: "stale", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" } }), 409, "MILESTONE_CONFLICT");
  const deliverableCreate = await app.inject({ method: "POST", url: `/api/v1/projects/${projectA.id}/deliverables`, headers: headers(clerkIds.admin), payload: { name: `${marker}_DELIVERABLE`, description: "Controlled", milestoneId: milestone.id } }); status(deliverableCreate, 201, "DELIVERABLE_CREATE"); let deliverable = data<Deliverable>(deliverableCreate); deliverableIds.push(deliverable.id);
  status(await app.inject({ method: "POST", url: `/api/v1/projects/${projectB.id}/deliverables`, headers: headers(clerkIds.admin), payload: { name: `${marker}_WRONG_MILESTONE`, milestoneId: milestone.id } }), 404, "DELIVERABLE_MILESTONE_WRONG_PROJECT");
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectA.id}/deliverables/${deliverable.id}`, headers: headers(clerkIds.admin) }), 200, "DELIVERABLE_DETAIL");
  status(await app.inject({ method: "GET", url: `/api/v1/projects/${projectB.id}/deliverables/${deliverable.id}`, headers: headers(clerkIds.admin) }), 404, "DELIVERABLE_WRONG_PROJECT");
  const deliverableEdit = await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectA.id}/deliverables/${deliverable.id}`, headers: headers(clerkIds.admin), payload: { status: "approved", expectedUpdatedAt: deliverable.updatedAt } }); status(deliverableEdit, 200, "DELIVERABLE_APPROVE"); deliverable = data<Deliverable>(deliverableEdit); assert(deliverable.status === "approved", "DELIVERABLE_NOT_APPROVED");
  const createTask = async (payload: Record<string, unknown>, label: string) => { const response = await app.inject({ method: "POST", url: "/api/v1/tasks", headers: headers(clerkIds.admin), payload }); status(response, 201, `TASK_CREATE_${label}`); const task = data<Task>(response); taskIds.push(task.id); return task; };
  let standaloneTask = await createTask({ title: `${marker}_TASK_STANDALONE`, description: "Controlled", assignedToUserId: ids.admin, priority: "medium", dueDate: "2026-09-15", estimatedMinutes: 60 }, "STANDALONE");
  let projectTask = await createTask({ projectId: projectA.id, title: `${marker}_TASK_PROJECT`, description: "Controlled", assignedToUserId: ids.admin, priority: "high", dueDate: "2026-09-15", estimatedMinutes: 120 }, "PROJECT");
  const otherProjectTask = await createTask({ projectId: projectB.id, title: `${marker}_TASK_PROJECT_B`, description: "Controlled", assignedToUserId: ids.admin, priority: "low", dueDate: "2026-09-20" }, "PROJECT_B");
  status(await app.inject({ method: "GET", url: `/api/v1/tasks/${projectTask.id}`, headers: headers(clerkIds.clientA) }), 200, "TASK_OWN_PROJECT");
  status(await app.inject({ method: "GET", url: `/api/v1/tasks/${otherProjectTask.id}`, headers: headers(clerkIds.clientA) }), 404, "TASK_WRONG_PROJECT");
  status(await app.inject({ method: "POST", url: "/api/v1/tasks", headers: headers(clerkIds.clientA), payload: { projectId: projectB.id, title: `${marker}_TASK_CROSS_TENANT`, description: "Forbidden", assignedToUserId: ids.clientA, dueDate: "2026-09-15" } }), 404, "TASK_PROJECT_CROSS_TENANT");
  const taskEdit = await app.inject({ method: "PATCH", url: `/api/v1/tasks/${projectTask.id}`, headers: headers(clerkIds.admin), payload: { estimatedMinutes: 150, expectedUpdatedAt: projectTask.updatedAt } }); status(taskEdit, 200, "TASK_EDIT"); projectTask = data<Task>(taskEdit); assert(projectTask.estimatedMinutes === 150, "TASK_MINUTES_NOT_UPDATED");
  status(await app.inject({ method: "PATCH", url: `/api/v1/tasks/${projectTask.id}`, headers: headers(clerkIds.admin), payload: { title: "stale", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" } }), 409, "TASK_CONFLICT");
  status(await app.inject({ method: "POST", url: `/api/v1/tasks/${projectTask.id}/transition`, headers: headers(clerkIds.admin), payload: { status: "completed" } }), 409, "TASK_INVALID_TRANSITION");
  const assignedTask = await app.inject({ method: "POST", url: `/api/v1/tasks/${projectTask.id}/assign`, headers: headers(clerkIds.admin), payload: { assignedToUserId: ids.clientA, expectedUpdatedAt: projectTask.updatedAt } }); status(assignedTask, 200, "TASK_ASSIGN_KNOWN_MEMBER"); projectTask = data<Task>(assignedTask); assert(projectTask.assignedToUserId === ids.clientA, "TASK_NOT_ASSIGNED");
  const readyTask = await app.inject({ method: "POST", url: `/api/v1/tasks/${projectTask.id}/transition`, headers: headers(clerkIds.clientA), payload: { status: "ready" } }); status(readyTask, 200, "TASK_TRANSITION_PROJECT_MEMBER"); projectTask = data<Task>(readyTask);
  const standaloneReady = await app.inject({ method: "POST", url: `/api/v1/tasks/${standaloneTask.id}/transition`, headers: headers(clerkIds.admin), payload: { status: "ready" } }); status(standaloneReady, 200, "TASK_TRANSITION_STANDALONE"); standaloneTask = data<Task>(standaloneReady);
  status(await app.inject({ method: "GET", url: `/api/v1/tasks/${randomUUID()}`, headers: headers(clerkIds.admin) }), 404, "TASK_NOT_FOUND");
  status(await app.inject({ method: "POST", url: "/api/v1/tasks", headers: headers(clerkIds.clientA), payload: { title: `${marker}_FORBIDDEN`, description: "Forbidden standalone", assignedToUserId: ids.clientA, dueDate: "2026-09-15" } }), 403, "TASK_CLIENT_STANDALONE_DENIED");
  const memberRevoke = await app.inject({ method: "POST", url: `/api/v1/projects/${projectA.id}/members/${ids.clientA}/revoke`, headers: headers(clerkIds.admin), payload: { expectedUpdatedAt: clientMember.updatedAt } }); status(memberRevoke, 200, "MEMBER_REVOKE"); assert(data<Member>(memberRevoke).status === "revoked", "MEMBER_NOT_REVOKED");
  result = { marker, projects: { list: 200, detail: 200, edit: 200, transition: 200, invalidTransition: 409, concurrency: 409, readOnlyManageDenied: 403, crossTenantWrite: 403 }, members: { list: 200, edit: 200, revoke: 200, wrongProject: 404 }, milestones: { create: 201, detail: 200, edit: 200, wrongProject: 404, concurrency: 409 }, deliverables: { create: 201, detail: 200, approve: 200, wrongProject: 404, milestoneWrongProject: 404 }, tasks: { standalone: 201, project: 201, edit: 200, assignKnownMember: 200, transitionByMember: 200, invalidTransition: 409, concurrency: 409, missing: 404, wrongProject: 404, clientStandaloneDenied: 403, crossTenantCreateDenied: 404 }, crossTenantRead: 404, crossTenantWrite: 403 };
} catch (error) { smokeError = error; }
finally {
  try {
    await pool.query("BEGIN");
    await pool.query(`DELETE FROM audit_events WHERE actor_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[]) OR entity_id=ANY($3::uuid[])`, [[ids.admin, ids.clientA], [ids.organizationA, ids.organizationB], [...projectIds, ...milestoneIds, ...deliverableIds, ...taskIds]]);
    await pool.query(`DELETE FROM tasks WHERE id=ANY($1::uuid[])`, [taskIds]);
    await pool.query(`DELETE FROM deliverables WHERE id=ANY($1::uuid[])`, [deliverableIds]);
    await pool.query(`DELETE FROM project_milestones WHERE id=ANY($1::uuid[])`, [milestoneIds]);
    await pool.query(`DELETE FROM project_members WHERE project_id=ANY($1::uuid[])`, [projectIds]);
    await pool.query(`DELETE FROM projects WHERE id=ANY($1::uuid[])`, [projectIds]);
    await pool.query(`DELETE FROM organization_memberships WHERE organization_id=ANY($1::uuid[])`, [[ids.organizationA, ids.organizationB]]);
    await pool.query(`DELETE FROM organizations WHERE id=ANY($1::uuid[])`, [[ids.organizationA, ids.organizationB]]);
    await pool.query(`DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])`, [[ids.admin, ids.clientA]]);
    await pool.query(`DELETE FROM app_users WHERE id=ANY($1::uuid[])`, [[ids.admin, ids.clientA]]);
    await pool.query("COMMIT");
  } catch (error) { await pool.query("ROLLBACK").catch(() => undefined); cleanupError = error; }
  const residual = await pool.query<{ total: number }>(`SELECT ((SELECT count(*) FROM projects WHERE name LIKE $1)+(SELECT count(*) FROM project_milestones WHERE name LIKE $1)+(SELECT count(*) FROM deliverables WHERE name LIKE $1)+(SELECT count(*) FROM tasks WHERE title LIKE $1)+(SELECT count(*) FROM organizations WHERE name LIKE $1)+(SELECT count(*) FROM app_users WHERE clerk_user_id LIKE $1))::int total`, [`${marker}%`]).catch(() => ({ rows: [{ total: -1 }] }));
  console.log(JSON.stringify({ ...result, residualFixtures: residual.rows[0]?.total ?? -1 }, null, 2));
  await app.close(); await pool.end();
}
if (smokeError !== undefined) throw smokeError instanceof Error ? smokeError : new Error("Smoke failed", { cause: smokeError });
if (cleanupError !== undefined) throw cleanupError instanceof Error ? cleanupError : new Error("Cleanup failed", { cause: cleanupError });
