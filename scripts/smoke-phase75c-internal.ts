import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_MISSING");
const marker = `PHASE75C_SMOKE_${randomUUID().replaceAll("-", "")}`;
const ids = {
  admin: randomUUID(), support: randomUUID(), clientA: randomUUID(), clientB: randomUUID(),
  organizationA: randomUUID(), organizationB: randomUUID(), projectA: randomUUID(),
  leadStandalone: randomUUID(), leadCreate: randomUUID(), leadReuse: randomUUID(),
};
const clerkIds = { admin: `${marker}_admin`, support: `${marker}_support`, clientA: `${marker}_client_a`, clientB: `${marker}_client_b` };
const userIds: string[] = [ids.admin, ids.support, ids.clientA, ids.clientB];
const organizationIds: string[] = [ids.organizationA, ids.organizationB];
const leadIds: string[] = [ids.leadStandalone, ids.leadCreate, ids.leadReuse];
const ticketIds: string[] = [];
const commentIds: string[] = [];
const conversionOrganizationIds: string[] = [];
const pool = new Pool({ connectionString, max: 10 });
const authenticationProvider: AuthenticationProvider = { authenticate: (request) => { const value = request.headers["x-phase75c-smoke-user"]; return Promise.resolve(typeof value === "string" ? { clerkUserId: value } : null); } };
const app = await buildApp({ env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "3005", LOG_LEVEL: "silent", TRUST_PROXY: "false", CORS_ORIGINS: "http://localhost:5173", RATE_LIMIT_MAX: "1000" }, logger: false, authenticationProvider });
type Response = { readonly statusCode: number; json<T>(): T };
type Lead = { readonly id: string; readonly status: string; readonly assignedToUserId: string | null; readonly companyName: string | null };
type Conversion = { readonly organizationId: string | null; readonly status: string; readonly mode: string };
type Ticket = { readonly id: string; readonly organizationId: string | null; readonly projectId: string | null; readonly status: string; readonly priority: string; readonly assignedToUserId: string | null; readonly updatedAt: string };
type Comment = { readonly id: string; readonly visibility: string };
const headers = (user: string) => ({ "x-phase75c-smoke-user": user });
const data = <T>(response: Response): T => response.json<{ data: T }>().data;
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); }
function status(response: Response, expected: number, label: string) { assert(response.statusCode === expected, `${label}_EXPECTED_${expected}_GOT_${response.statusCode}`); }
let smokeError: unknown, cleanupError: unknown, result: Record<string, unknown> | undefined;

try {
  await pool.query(`INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active'),($7,$8,$9,'active'),($10,$11,$12,'active')`, [ids.admin, clerkIds.admin, `${marker}_admin@example.test`, ids.support, clerkIds.support, `${marker}_support@example.test`, ids.clientA, clerkIds.clientA, `${marker}_a@example.test`, ids.clientB, clerkIds.clientB, `${marker}_b@example.test`]);
  await pool.query(`INSERT INTO user_roles (user_id,role_id,role_scope) SELECT fixture.user_id,r.id,'global' FROM (VALUES ($1::uuid,'super_admin'),($2::uuid,'support_agent')) fixture(user_id,code) JOIN roles r ON r.scope='global' AND r.code=fixture.code`, [ids.admin, ids.support]);
  await pool.query(`INSERT INTO organizations (id,name,status) VALUES ($1,$2,'active'),($3,$4,'active')`, [ids.organizationA, `${marker}_ORG_A`, ids.organizationB, `${marker}_ORG_B`]);
  await pool.query(`INSERT INTO organization_memberships (organization_id,user_id,role_id,role_scope,status,activated_at) SELECT fixture.organization_id,fixture.user_id,r.id,'organization','active',now() FROM (VALUES ($1::uuid,$2::uuid),($3::uuid,$4::uuid)) fixture(organization_id,user_id) JOIN roles r ON r.scope='organization' AND r.code='client_contact'`, [ids.organizationA, ids.clientA, ids.organizationB, ids.clientB]);
  await pool.query(`INSERT INTO projects (id,organization_id,name,description,status,priority,lead_user_id,start_date,due_date,created_by_user_id) VALUES ($1,$2,$3,'Controlled Phase 7.5C project','planning','medium',$4,'2026-08-01','2026-10-31',$4)`, [ids.projectA, ids.organizationA, `${marker}_PROJECT_A`, ids.admin]);
  await pool.query(`INSERT INTO project_members (project_id,organization_id,user_id,role_id,role_scope,assigned_by_user_id) SELECT $1,$2,$3,r.id,'project',$4 FROM roles r WHERE r.scope='project' AND r.code='project_member'`, [ids.projectA, ids.organizationA, ids.clientA, ids.admin]);

  const publicLead = await app.inject({ method: "POST", url: "/api/v1/leads", payload: { fullName: `${marker} Contact`, companyName: `${marker} Company`, email: `${marker}@example.test`, message: "Controlled Phase 7.5C lead", source: "contact" } });
  status(publicLead, 201, "LEAD_PUBLIC_CREATE"); const lead = data<Lead>(publicLead); leadIds.push(lead.id);
  const leadList = await app.inject({ method: "GET", url: `/api/v1/leads?page=1&pageSize=10&search=${marker}&status=new&sortBy=updatedAt&sortDirection=desc`, headers: headers(clerkIds.admin) }); status(leadList, 200, "LEAD_LIST"); assert(data<{ items: Lead[] }>(leadList).items.some((item) => item.id === lead.id), "LEAD_LIST_MISSING");
  status(await app.inject({ method: "GET", url: `/api/v1/leads/${lead.id}`, headers: headers(clerkIds.admin) }), 200, "LEAD_DETAIL");
  const editedLeadResponse = await app.inject({ method: "PATCH", url: `/api/v1/leads/${lead.id}`, headers: headers(clerkIds.admin), payload: { companyName: `${marker}_EDITED`, source: "referral" } }); status(editedLeadResponse, 200, "LEAD_EDIT");
  const assignedLeadResponse = await app.inject({ method: "POST", url: `/api/v1/leads/${lead.id}/assign`, headers: headers(clerkIds.admin), payload: { assignedToUserId: ids.support } }); status(assignedLeadResponse, 200, "LEAD_ASSIGN"); assert(data<Lead>(assignedLeadResponse).assignedToUserId === ids.support, "LEAD_ASSIGNMENT_MISMATCH");
  const transitionedLead = await app.inject({ method: "POST", url: `/api/v1/leads/${lead.id}/transition`, headers: headers(clerkIds.admin), payload: { status: "contacted" } }); status(transitionedLead, 200, "LEAD_TRANSITION");
  status(await app.inject({ method: "POST", url: `/api/v1/leads/${lead.id}/transition`, headers: headers(clerkIds.admin), payload: { status: "approved" } }), 409, "LEAD_INVALID_TRANSITION");
  status(await app.inject({ method: "GET", url: "/api/v1/leads", headers: headers(clerkIds.clientA) }), 403, "LEAD_CLIENT_DENIED");
  status(await app.inject({ method: "GET", url: `/api/v1/leads/${randomUUID()}`, headers: headers(clerkIds.admin) }), 404, "LEAD_MISSING");
  await pool.query(`INSERT INTO leads (id,full_name,email,message,source,status,assigned_to_user_id) VALUES ($1,$2,$3,'Controlled','contact','approved',$7),($4,$5,$6,'Controlled','contact','approved',$7),($8,$9,$10,'Controlled','contact','approved',$7)`, [ids.leadStandalone, `${marker}_STANDALONE`, `${marker}_standalone@example.test`, ids.leadCreate, `${marker}_CREATE`, `${marker}_create@example.test`, ids.admin, ids.leadReuse, `${marker}_REUSE`, `${marker}_reuse@example.test`]);
  const convert = async (leadId: string, payload: Record<string, unknown>, label: string) => { const response = await app.inject({ method: "POST", url: `/api/v1/leads/${leadId}/convert`, headers: headers(clerkIds.admin), payload }); status(response, 200, label); const value = data<Conversion>(response); if (value.organizationId && !organizationIds.includes(value.organizationId)) conversionOrganizationIds.push(value.organizationId); return value; };
  const standaloneConversion = await convert(ids.leadStandalone, { mode: "standalone" }, "LEAD_CONVERT_STANDALONE");
  const createConversion = await convert(ids.leadCreate, { mode: "create_organization", name: `${marker}_CONVERTED_ORG` }, "LEAD_CONVERT_CREATE");
  const reuseConversion = await convert(ids.leadReuse, { mode: "reuse_organization", organizationId: ids.organizationA }, "LEAD_CONVERT_REUSE");
  assert(standaloneConversion.organizationId === null && createConversion.organizationId !== null && reuseConversion.organizationId === ids.organizationA, "LEAD_CONVERSION_MODE_MISMATCH");

  const createTicket = async (clerkId: string, payload: Record<string, unknown>, label: string) => { const response = await app.inject({ method: "POST", url: "/api/v1/tickets", headers: headers(clerkId), payload }); status(response, 201, label); const ticket = data<Ticket>(response); ticketIds.push(ticket.id); return ticket; };
  let standalone = await createTicket(clerkIds.clientA, { type: "incident", requestedPriority: "high", subject: `${marker}_STANDALONE_TICKET`, description: "Controlled standalone ticket" }, "TICKET_STANDALONE");
  const organizational = await createTicket(clerkIds.clientA, { organizationId: ids.organizationA, type: "service_request", subject: `${marker}_ORG_TICKET`, description: "Controlled organization ticket" }, "TICKET_ORGANIZATION");
  const project = await createTicket(clerkIds.clientA, { projectId: ids.projectA, type: "bug", subject: `${marker}_PROJECT_TICKET`, description: "Controlled project ticket" }, "TICKET_PROJECT");
  const foreign = await createTicket(clerkIds.clientB, { organizationId: ids.organizationB, type: "question", subject: `${marker}_FOREIGN_TICKET`, description: "Controlled foreign ticket" }, "TICKET_FOREIGN");
  assert(organizational.organizationId === ids.organizationA && project.projectId === ids.projectA && standalone.organizationId === null, "TICKET_CONTEXT_MISMATCH");
  const ticketList = await app.inject({ method: "GET", url: `/api/v1/tickets?page=1&pageSize=10&search=${marker}&priority=high&sortBy=updatedAt&sortDirection=desc`, headers: headers(clerkIds.admin) }); status(ticketList, 200, "TICKET_LIST");
  status(await app.inject({ method: "GET", url: `/api/v1/tickets/${standalone.id}`, headers: headers(clerkIds.admin) }), 200, "TICKET_DETAIL");
  status(await app.inject({ method: "GET", url: `/api/v1/tickets/${foreign.id}`, headers: headers(clerkIds.clientA) }), 404, "TICKET_CROSS_TENANT");
  const editTicket = await app.inject({ method: "PATCH", url: `/api/v1/tickets/${standalone.id}`, headers: headers(clerkIds.admin), payload: { subject: `${marker}_STANDALONE_EDITED`, requestedPriority: "medium", expectedUpdatedAt: standalone.updatedAt } }); status(editTicket, 200, "TICKET_EDIT"); const staleUpdatedAt = standalone.updatedAt; standalone = data<Ticket>(editTicket);
  status(await app.inject({ method: "PATCH", url: `/api/v1/tickets/${standalone.id}`, headers: headers(clerkIds.admin), payload: { description: "stale", expectedUpdatedAt: staleUpdatedAt } }), 409, "TICKET_CONFLICT");
  const assign = async (assignedToUserId: string | null, label: string) => { const response = await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/assign`, headers: headers(clerkIds.admin), payload: { assignedToUserId, expectedUpdatedAt: standalone.updatedAt } }); status(response, 200, label); standalone = data<Ticket>(response); };
  await assign(ids.support, "TICKET_ASSIGN"); await assign(null, "TICKET_UNASSIGN"); await assign(ids.support, "TICKET_REASSIGN");
  const priorityResponse = await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/priority`, headers: headers(clerkIds.admin), payload: { priority: "urgent", expectedUpdatedAt: standalone.updatedAt } }); status(priorityResponse, 200, "TICKET_PRIORITY"); standalone = data<Ticket>(priorityResponse); assert(standalone.priority === "urgent", "TICKET_PRIORITY_MISMATCH");
  status(await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/assign`, headers: headers(clerkIds.clientA), payload: { assignedToUserId: ids.clientA } }), 403, "TICKET_ASSIGN_CLIENT_DENIED");
  const clientCommentResponse = await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/comments`, headers: headers(clerkIds.clientA), payload: { content: "Visible controlled comment", visibility: "client" } }); status(clientCommentResponse, 201, "COMMENT_CLIENT"); commentIds.push(data<Comment>(clientCommentResponse).id);
  const internalCommentResponse = await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/comments`, headers: headers(clerkIds.support), payload: { content: "Internal controlled comment", visibility: "internal" } }); status(internalCommentResponse, 201, "COMMENT_INTERNAL"); commentIds.push(data<Comment>(internalCommentResponse).id);
  const clientComments = await app.inject({ method: "GET", url: `/api/v1/tickets/${standalone.id}/comments`, headers: headers(clerkIds.clientA) }); status(clientComments, 200, "COMMENTS_CLIENT_LIST"); assert(data<Comment[]>(clientComments).every((item) => item.visibility === "client"), "INTERNAL_COMMENT_LEAK");
  const internalComments = await app.inject({ method: "GET", url: `/api/v1/tickets/${standalone.id}/comments`, headers: headers(clerkIds.support) }); status(internalComments, 200, "COMMENTS_INTERNAL_LIST"); assert(data<Comment[]>(internalComments).some((item) => item.visibility === "internal"), "INTERNAL_COMMENT_MISSING");
  for (const [next, extra] of [["classifying", {}], ["assigned", {}], ["in_progress", {}], ["resolved", { resolution: "Controlled Phase 7.5C resolution" }]] as const) { const response = await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/transition`, headers: headers(clerkIds.support), payload: { status: next, expectedUpdatedAt: standalone.updatedAt, ...extra } }); status(response, 200, `TICKET_TRANSITION_${next}`); standalone = data<Ticket>(response); }
  status(await app.inject({ method: "POST", url: `/api/v1/tickets/${standalone.id}/transition`, headers: headers(clerkIds.support), payload: { status: "assigned", expectedUpdatedAt: standalone.updatedAt } }), 409, "TICKET_INVALID_TRANSITION");
  result = { marker, leads: { list: 200, detail: 200, edit: 200, assign: 200, transition: 200, invalidTransition: 409, forbidden: 403, missing: 404, conversions: [standaloneConversion.mode, createConversion.mode, reuseConversion.mode] }, tickets: { contexts: ["standalone", "organization", "project"], list: 200, detail: 200, edit: 200, assign: 200, unassign: 200, priority: 200, transition: 200, conflict: 409, crossTenant: 404, forbidden: 403 }, comments: { explicitClient: 201, explicitInternal: 201, clientInternalLeak: false, internalRead: true }, dualIdentityPortalGuard: "frontend blocks conversation for internal identities" };
} catch (error) { smokeError = error; }
finally {
  try {
    await pool.query("BEGIN");
    await pool.query(`DELETE FROM audit_events WHERE actor_user_id=ANY($1::uuid[]) OR organization_id=ANY($2::uuid[]) OR entity_id=ANY($3::uuid[])`, [userIds, [...organizationIds, ...conversionOrganizationIds], [...leadIds, ...ticketIds, ...commentIds, ids.projectA]]);
    await pool.query(`DELETE FROM ticket_comments WHERE ticket_id=ANY($1::uuid[]) OR author_user_id=ANY($2::uuid[])`, [ticketIds, userIds]);
    await pool.query(`DELETE FROM tickets WHERE id=ANY($1::uuid[]) OR requester_user_id=ANY($2::uuid[])`, [ticketIds, userIds]);
    await pool.query(`DELETE FROM leads WHERE id=ANY($1::uuid[]) OR email LIKE $2`, [leadIds, `${marker}%`]);
    await pool.query(`DELETE FROM project_members WHERE project_id=$1`, [ids.projectA]);
    await pool.query(`DELETE FROM projects WHERE id=$1`, [ids.projectA]);
    await pool.query(`DELETE FROM organization_memberships WHERE organization_id=ANY($1::uuid[])`, [[...organizationIds, ...conversionOrganizationIds]]);
    await pool.query(`DELETE FROM organizations WHERE id=ANY($1::uuid[])`, [[...organizationIds, ...conversionOrganizationIds]]);
    await pool.query(`DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])`, [userIds]);
    await pool.query(`DELETE FROM app_users WHERE id=ANY($1::uuid[])`, [userIds]);
    await pool.query("COMMIT");
  } catch (error) { await pool.query("ROLLBACK").catch(() => undefined); cleanupError = error; }
  const residual = await pool.query<{ total: number }>(`SELECT ((SELECT count(*) FROM app_users WHERE clerk_user_id LIKE $1)+(SELECT count(*) FROM organizations WHERE name LIKE $1)+(SELECT count(*) FROM projects WHERE name LIKE $1)+(SELECT count(*) FROM leads WHERE email LIKE $1)+(SELECT count(*) FROM tickets WHERE subject LIKE $1)+(SELECT count(*) FROM ticket_comments WHERE author_user_id=ANY($2::uuid[]))+(SELECT count(*) FROM audit_events WHERE actor_user_id=ANY($2::uuid[])))::int total`, [`${marker}%`, userIds]).catch(() => ({ rows: [{ total: -1 }] }));
  console.log(JSON.stringify({ ...result, residualFixtures: residual.rows[0]?.total ?? -1 }, null, 2));
  await app.close(); await pool.end();
}
if (smokeError !== undefined) throw smokeError instanceof Error ? smokeError : new Error("PHASE75C_SMOKE_FAILED", { cause: smokeError });
if (cleanupError !== undefined) throw cleanupError instanceof Error ? cleanupError : new Error("PHASE75C_CLEANUP_FAILED", { cause: cleanupError });
