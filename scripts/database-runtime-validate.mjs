import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";
import { URL } from "node:url";

const EXPECTED_HASH = "46D9EDDF29A0ABC25091E43867D0AC6B11A1AE180BDDF12665254BE9CD178CD6";
const ORIGINAL_SQL = "C:\\Users\\leopa\\Downloads\\ilvox_complete_reconstructed.sql";
const BASELINE_SQL = resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql");
const DRIZZLE_SNAPSHOT = resolve("drizzle", "migrations", "meta", "0000_snapshot.json");

const useDatabaseUrl = process.argv.includes("--database-url");
const variable = useDatabaseUrl ? "DATABASE_URL" : "TEST_DATABASE_URL";
const connectionString = process.env[variable];
if (connectionString === undefined || connectionString.trim() === "") {
  console.error(JSON.stringify({ status: "blocked", reason: `${variable}_MISSING` }));
  process.exit(2);
}

const parsedUrl = new URL(connectionString);
const originalSql = readFileSync(ORIGINAL_SQL, "utf8");
const baselineSql = readFileSync(BASELINE_SQL, "utf8");
const drizzleSnapshot = JSON.parse(readFileSync(DRIZZLE_SNAPSHOT, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();
const originalHash = sha256(originalSql);
const baselineHash = sha256(baselineSql);
if (originalHash !== EXPECTED_HASH || baselineHash !== EXPECTED_HASH) {
  console.error(
    JSON.stringify({
      status: "blocked",
      reason: "HASH_MISMATCH",
      original: { path: ORIGINAL_SQL, sha256: originalHash },
      baseline: { path: BASELINE_SQL, sha256: baselineHash },
    }),
  );
  process.exit(3);
}

const schema = `ilvox_validation_20260722_${randomBytes(4).toString("hex")}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const qs = quoteIdentifier(schema);
const client = new pg.Client({ connectionString });
const notices = [];
client.on("notice", (notice) => {
  notices.push({ severity: notice.severity, code: notice.code, message: notice.message });
});

const ids = {
  user1: "00000000-0000-4000-8000-000000000001",
  user2: "00000000-0000-4000-8000-000000000002",
  organization: "00000000-0000-4000-8000-000000000101",
  organizationCheck: "00000000-0000-4000-8000-000000000102",
  service: "00000000-0000-4000-8000-000000000201",
  lead: "00000000-0000-4000-8000-000000000301",
  project: "00000000-0000-4000-8000-000000000401",
  milestone: "00000000-0000-4000-8000-000000000501",
  deliverable: "00000000-0000-4000-8000-000000000601",
  ticket: "00000000-0000-4000-8000-000000000701",
  comment: "00000000-0000-4000-8000-000000000801",
  taskProject: "00000000-0000-4000-8000-000000000901",
  taskTicket: "00000000-0000-4000-8000-000000000902",
  taskGlobal: "00000000-0000-4000-8000-000000000903",
  fileProject: "00000000-0000-4000-8000-000000000a01",
  fileTicket: "00000000-0000-4000-8000-000000000a02",
  fileComment: "00000000-0000-4000-8000-000000000a03",
  fileTask: "00000000-0000-4000-8000-000000000a04",
  fileDeliverable: "00000000-0000-4000-8000-000000000a05",
  audit: "00000000-0000-4000-8000-000000000b01",
  webhook: "00000000-0000-4000-8000-000000000c01",
  validationRole: "00000000-0000-4000-8000-000000000d01",
  validationPermission: "00000000-0000-4000-8000-000000000e01",
};

async function setupFixtures() {
  await client.query(
    `INSERT INTO app_users (id, clerk_user_id, primary_email, status)
     VALUES ($1, 'runtime_user_1', 'runtime1@example.test', 'active'),
            ($2, 'runtime_user_2', 'runtime2@example.test', 'active')`,
    [ids.user1, ids.user2],
  );
  await client.query(
    `INSERT INTO roles (id, scope, code, name) VALUES ($1, 'global', 'runtime_validation', 'Runtime validation')`,
    [ids.validationRole],
  );
  await client.query(
    `INSERT INTO permissions (id, code, module, name) VALUES ($1, 'runtime.validation', 'runtime', 'Runtime validation')`,
    [ids.validationPermission],
  );
  await client.query(
    `INSERT INTO user_roles (user_id, role_id, role_scope, assigned_by_user_id)
     SELECT $1, id, 'global', $2 FROM roles WHERE scope='global' AND code='admin'`,
    [ids.user1, ids.user2],
  );
  await client.query(
    `INSERT INTO identity_webhook_events
       (id, clerk_event_id, event_type, status, attempt_count)
     VALUES ($1, 'runtime_event', 'user.updated', 'received', 0)`,
    [ids.webhook],
  );
  await client.query(
    `INSERT INTO organizations
       (id, name, status, country_code, account_manager_user_id)
     VALUES ($1, 'Runtime organization', 'active', 'CO', $3),
            ($2, 'Runtime check organization', 'active', 'CO', NULL)`,
    [ids.organization, ids.organizationCheck, ids.user1],
  );
  await client.query(
    `INSERT INTO organization_memberships
       (organization_id, user_id, role_id, role_scope, status, activated_at)
     SELECT $1, $2, id, 'organization', 'active', now()
     FROM roles WHERE scope='organization' AND code='client_manager'`,
    [ids.organization, ids.user1],
  );
  await client.query(
    `INSERT INTO services (id, name, category, description)
     VALUES ($1, 'Runtime service', 'development', 'Runtime validation service')`,
    [ids.service],
  );
  await client.query(
    `INSERT INTO leads
       (id, full_name, email, service_id, message, source, status,
        assigned_to_user_id, converted_organization_id, converted_at)
     VALUES ($1, 'Runtime lead', 'lead@example.test', $2, 'Runtime', 'contact',
             'converted', $3, $4, now())`,
    [ids.lead, ids.service, ids.user1, ids.organization],
  );
  await client.query(
    `INSERT INTO projects
       (id, organization_id, service_id, name, description, status, priority,
        lead_user_id, start_date, due_date, created_by_user_id)
     VALUES ($1, $2, $3, 'Runtime project', 'Runtime', 'planning', 'medium',
             $4, DATE '2026-01-01', DATE '2026-12-31', $4)`,
    [ids.project, ids.organization, ids.service, ids.user1],
  );
  await client.query(
    `INSERT INTO project_members
       (project_id, organization_id, user_id, role_id, role_scope, assigned_by_user_id)
     SELECT $1, $2, $3, id, 'project', $4
     FROM roles WHERE scope='project' AND code='project_member'`,
    [ids.project, ids.organization, ids.user1, ids.user2],
  );
  await client.query(
    `INSERT INTO project_milestones
       (id, project_id, organization_id, name, status, due_date, completed_at)
     VALUES ($1, $2, $3, 'Runtime milestone', 'completed', DATE '2026-06-01', now())`,
    [ids.milestone, ids.project, ids.organization],
  );
  await client.query(
    `INSERT INTO deliverables
       (id, project_id, organization_id, name, status, approved_by_user_id, approved_at)
     VALUES ($1, $2, $3, 'Runtime deliverable', 'approved', $4, now())`,
    [ids.deliverable, ids.project, ids.organization, ids.user1],
  );
  await client.query(
    `INSERT INTO tickets
       (id, organization_id, project_id, requester_user_id, assigned_to_user_id,
        ticket_year, type, status, subject, description, resolution, resolved_at)
     VALUES ($1, $2, $3, $4, $5, 2026, 'incident', 'in_progress',
             'Runtime ticket', 'Runtime ticket', 'Fixture resolution', now())`,
    [ids.ticket, ids.organization, ids.project, ids.user1, ids.user2],
  );
  await client.query(
    `INSERT INTO ticket_comments
       (id, ticket_id, organization_id, author_user_id, visibility, content)
     VALUES ($1, $2, $3, $4, 'client', 'Runtime comment')`,
    [ids.comment, ids.ticket, ids.organization, ids.user1],
  );
  await client.query(
    `INSERT INTO tasks
       (id, organization_id, project_id, title, description, assigned_to_user_id,
        created_by_user_id, priority, status, due_date, estimated_minutes)
     VALUES ($1, $2, $3, 'Project task', 'Runtime', $4, $4, 'medium', 'pending', DATE '2026-06-01', 30)`,
    [ids.taskProject, ids.organization, ids.project, ids.user1],
  );
  await client.query(
    `INSERT INTO tasks
       (id, organization_id, ticket_id, title, description, assigned_to_user_id,
        created_by_user_id, priority, status, due_date, estimated_minutes)
     VALUES ($1, $2, $3, 'Ticket task', 'Runtime', $4, $4, 'medium', 'pending', DATE '2026-06-01', 30)`,
    [ids.taskTicket, ids.organization, ids.ticket, ids.user1],
  );
  await client.query(
    `INSERT INTO tasks
       (id, title, description, assigned_to_user_id, created_by_user_id,
        priority, status, due_date, estimated_minutes)
     VALUES ($1, 'Global task', 'Runtime', $2, $2, 'medium', 'pending', DATE '2026-06-01', 30)`,
    [ids.taskGlobal, ids.user1],
  );
  const checksum = "a".repeat(64);
  const fileRows = [
    [ids.fileProject, ids.project, null, null, null, null, "project"],
    [ids.fileTicket, null, ids.ticket, null, null, null, "ticket"],
    [ids.fileComment, null, null, ids.comment, null, null, "comment"],
    [ids.fileTask, null, null, null, ids.taskProject, null, "task"],
    [ids.fileDeliverable, null, null, null, null, ids.deliverable, "deliverable"],
  ];
  for (const row of fileRows) {
    await client.query(
      `INSERT INTO files
         (id, organization_id, project_id, ticket_id, ticket_comment_id, task_id,
          deliverable_id, uploaded_by_user_id, original_name, storage_provider,
          object_key, mime_type, size_bytes, checksum_sha256, classification, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'runtime.txt', 'memory', $9,
               'text/plain', 10, $10, 'confidential', 'active')`,
      [row[0], ids.organization, row[1], row[2], row[3], row[4], row[5], ids.user1, `runtime/${row[6]}`, checksum],
    );
  }
  await client.query(
    `INSERT INTO audit_events
       (id, actor_user_id, organization_id, action, entity_type, entity_id,
        old_values, new_values, request_id)
     VALUES ($1, $2, $3, 'runtime.validate', 'runtime', $4, '{}'::jsonb, '{}'::jsonb, $5)`,
    [ids.audit, ids.user1, ids.organization, ids.project, randomUUID()],
  );
}

const validByTable = {
  app_users: `UPDATE app_users SET id=id WHERE id='${ids.user1}'`,
  roles: `UPDATE roles SET id=id WHERE id='${ids.validationRole}'`,
  permissions: `UPDATE permissions SET id=id WHERE id='${ids.validationPermission}'`,
  identity_webhook_events: `UPDATE identity_webhook_events SET id=id WHERE id='${ids.webhook}'`,
  organizations: `UPDATE organizations SET id=id WHERE id='${ids.organizationCheck}'`,
  organization_memberships: `UPDATE organization_memberships SET status=status WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`,
  services: `UPDATE services SET id=id WHERE id='${ids.service}'`,
  leads: `UPDATE leads SET id=id WHERE id='${ids.lead}'`,
  projects: `UPDATE projects SET id=id WHERE id='${ids.project}'`,
  project_members: `UPDATE project_members SET user_id=user_id WHERE project_id='${ids.project}' AND user_id='${ids.user1}'`,
  project_milestones: `UPDATE project_milestones SET id=id WHERE id='${ids.milestone}'`,
  deliverables: `UPDATE deliverables SET id=id WHERE id='${ids.deliverable}'`,
  tickets: `UPDATE tickets SET id=id WHERE id='${ids.ticket}'`,
  ticket_comments: `UPDATE ticket_comments SET id=id WHERE id='${ids.comment}'`,
  tasks: `UPDATE tasks SET id=id WHERE id='${ids.taskProject}'`,
  files: `UPDATE files SET id=id WHERE id='${ids.fileProject}'`,
  audit_events: `UPDATE audit_events SET id=id WHERE id='${ids.audit}'`,
  user_roles: `UPDATE user_roles SET user_id=user_id WHERE user_id='${ids.user1}'`,
};

const checkCases = [
  ["chk_app_users_clerk_user_id_not_blank", "app_users", `UPDATE app_users SET clerk_user_id='  ' WHERE id='${ids.user1}'`],
  ["chk_app_users_primary_email_not_blank", "app_users", `UPDATE app_users SET primary_email='  ' WHERE id='${ids.user1}'`],
  ["chk_app_users_status", "app_users", `UPDATE app_users SET status='invalid' WHERE id='${ids.user1}'`],
  ["chk_roles_scope", "roles", `UPDATE roles SET scope='invalid' WHERE id='${ids.validationRole}'`],
  ["chk_roles_code_not_blank", "roles", `UPDATE roles SET code='  ' WHERE id='${ids.validationRole}'`],
  ["chk_roles_name_not_blank", "roles", `UPDATE roles SET name='  ' WHERE id='${ids.validationRole}'`],
  ["chk_permissions_code_not_blank", "permissions", `UPDATE permissions SET code='  ' WHERE id='${ids.validationPermission}'`],
  ["chk_permissions_module_not_blank", "permissions", `UPDATE permissions SET module='  ' WHERE id='${ids.validationPermission}'`],
  ["chk_permissions_name_not_blank", "permissions", `UPDATE permissions SET name='  ' WHERE id='${ids.validationPermission}'`],
  ["chk_user_roles_global_scope", "user_roles", `UPDATE user_roles SET role_scope='project' WHERE user_id='${ids.user1}'`],
  ["chk_identity_webhook_events_status", "identity_webhook_events", `UPDATE identity_webhook_events SET status='invalid' WHERE id='${ids.webhook}'`],
  ["chk_identity_webhook_events_attempt_count", "identity_webhook_events", `UPDATE identity_webhook_events SET attempt_count=-1 WHERE id='${ids.webhook}'`],
  ["chk_identity_webhook_events_processed_at", "identity_webhook_events", `UPDATE identity_webhook_events SET status='processed', processed_at=NULL WHERE id='${ids.webhook}'`],
  ["chk_organizations_name_not_blank", "organizations", `UPDATE organizations SET name='  ' WHERE id='${ids.organizationCheck}'`],
  ["chk_organizations_size", "organizations", `UPDATE organizations SET size='invalid' WHERE id='${ids.organizationCheck}'`],
  ["chk_organizations_status", "organizations", `UPDATE organizations SET status='invalid' WHERE id='${ids.organizationCheck}'`],
  ["chk_organizations_country_code", "organizations", `UPDATE organizations SET country_code='x1' WHERE id='${ids.organizationCheck}'`],
  ["chk_organizations_tax_fields", "organizations", `UPDATE organizations SET tax_id='123', tax_id_normalized=NULL WHERE id='${ids.organizationCheck}'`],
  ["chk_organization_memberships_scope", "organization_memberships", `UPDATE organization_memberships SET role_scope='global' WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`],
  ["chk_organization_memberships_status", "organization_memberships", `UPDATE organization_memberships SET status='invalid' WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`],
  ["chk_organization_memberships_timestamps", "organization_memberships", `UPDATE organization_memberships SET status='active', activated_at=NULL WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`],
  ["chk_services_category", "services", `UPDATE services SET category='invalid' WHERE id='${ids.service}'`],
  ["chk_leads_source", "leads", `UPDATE leads SET source='invalid' WHERE id='${ids.lead}'`],
  ["chk_leads_status", "leads", `UPDATE leads SET status='invalid', converted_organization_id=NULL, converted_at=NULL WHERE id='${ids.lead}'`],
  ["chk_leads_conversion", "leads", `UPDATE leads SET status='converted', converted_organization_id=NULL, converted_at=NULL WHERE id='${ids.lead}'`],
  ["chk_projects_status", "projects", `UPDATE projects SET status='invalid' WHERE id='${ids.project}'`],
  ["chk_projects_priority", "projects", `UPDATE projects SET priority='invalid' WHERE id='${ids.project}'`],
  ["chk_projects_dates", "projects", `UPDATE projects SET start_date=DATE '2026-12-31', due_date=DATE '2026-01-01' WHERE id='${ids.project}'`],
  ["chk_project_members_scope", "project_members", `UPDATE project_members SET role_scope='global' WHERE project_id='${ids.project}' AND user_id='${ids.user1}'`],
  ["chk_project_milestones_status", "project_milestones", `UPDATE project_milestones SET status='invalid', completed_at=NULL WHERE id='${ids.milestone}'`],
  ["chk_project_milestones_completed_at", "project_milestones", `UPDATE project_milestones SET status='completed', completed_at=NULL WHERE id='${ids.milestone}'`],
  ["chk_deliverables_status", "deliverables", `UPDATE deliverables SET status='invalid', approved_by_user_id=NULL, approved_at=NULL WHERE id='${ids.deliverable}'`],
  ["chk_deliverables_approval", "deliverables", `UPDATE deliverables SET status='approved', approved_by_user_id=NULL, approved_at=NULL WHERE id='${ids.deliverable}'`],
  ["chk_tickets_ticket_year", "tickets", `UPDATE tickets SET ticket_year=1999 WHERE id='${ids.ticket}'`],
  ["chk_tickets_type", "tickets", `UPDATE tickets SET type='invalid' WHERE id='${ids.ticket}'`],
  ["chk_tickets_requested_priority", "tickets", `UPDATE tickets SET requested_priority='invalid' WHERE id='${ids.ticket}'`],
  ["chk_tickets_priority", "tickets", `UPDATE tickets SET priority='invalid' WHERE id='${ids.ticket}'`],
  ["chk_tickets_status", "tickets", `UPDATE tickets SET status='invalid' WHERE id='${ids.ticket}'`],
  ["chk_tickets_resolution", "tickets", `UPDATE tickets SET status='resolved', resolution=NULL, resolved_at=NULL WHERE id='${ids.ticket}'`],
  ["chk_tickets_closed_at", "tickets", `UPDATE tickets SET status='closed', closed_at=NULL WHERE id='${ids.ticket}'`],
  ["chk_ticket_comments_visibility", "ticket_comments", `UPDATE ticket_comments SET visibility='invalid' WHERE id='${ids.comment}'`],
  ["chk_ticket_comments_content", "ticket_comments", `UPDATE ticket_comments SET content='  ' WHERE id='${ids.comment}'`],
  ["chk_tasks_priority", "tasks", `UPDATE tasks SET priority='invalid' WHERE id='${ids.taskProject}'`],
  ["chk_tasks_status", "tasks", `UPDATE tasks SET status='invalid' WHERE id='${ids.taskProject}'`],
  ["chk_tasks_estimated_minutes", "tasks", `UPDATE tasks SET estimated_minutes=-1 WHERE id='${ids.taskProject}'`],
  ["chk_tasks_single_context", "tasks", `UPDATE tasks SET project_id='${ids.project}', ticket_id='${ids.ticket}' WHERE id='${ids.taskProject}'`],
  ["chk_tasks_context_organization", "tasks", `UPDATE tasks SET project_id=NULL, ticket_id=NULL, organization_id='${ids.organization}' WHERE id='${ids.taskProject}'`],
  ["chk_files_object_key_not_blank", "files", `UPDATE files SET object_key='  ' WHERE id='${ids.fileProject}'`],
  ["chk_files_size_bytes", "files", `UPDATE files SET size_bytes=0 WHERE id='${ids.fileProject}'`],
  ["chk_files_checksum_sha256", "files", `UPDATE files SET checksum_sha256='invalid' WHERE id='${ids.fileProject}'`],
  ["chk_files_classification", "files", `UPDATE files SET classification='invalid' WHERE id='${ids.fileProject}'`],
  ["chk_files_status", "files", `UPDATE files SET status='invalid' WHERE id='${ids.fileProject}'`],
  ["chk_files_single_parent", "files", `UPDATE files SET project_id=NULL, ticket_id=NULL, ticket_comment_id=NULL, task_id=NULL, deliverable_id=NULL WHERE id='${ids.fileProject}'`],
  ["chk_audit_events_old_values_object", "audit_events", `UPDATE audit_events SET old_values='[]'::jsonb WHERE id='${ids.audit}'`],
  ["chk_audit_events_new_values_object", "audit_events", `UPDATE audit_events SET new_values='[]'::jsonb WHERE id='${ids.audit}'`],
].map(([name, table, invalid]) => ({ name, table, invalid }));

checkCases.find((item) => item.name === "chk_tasks_single_context").beforeInvalid =
  "ALTER TABLE tasks RENAME CONSTRAINT chk_tasks_context_organization TO zz_chk_tasks_context_organization";

const fkCases = [
  ["audit_events_actor_user_id_fkey", "audit_events", `c.id='${ids.audit}'`, `UPDATE audit_events SET actor_user_id='ffffffff-ffff-4fff-8fff-000000000001' WHERE id='${ids.audit}'`],
  ["audit_events_organization_id_fkey", "audit_events", `c.id='${ids.audit}'`, `UPDATE audit_events SET organization_id='ffffffff-ffff-4fff-8fff-000000000002' WHERE id='${ids.audit}'`],
  ["files_organization_id_fkey", "files", `c.id='${ids.fileProject}'`, `UPDATE files SET organization_id='ffffffff-ffff-4fff-8fff-000000000003' WHERE id='${ids.fileProject}'`],
  ["files_uploaded_by_user_id_fkey", "files", `c.id='${ids.fileProject}'`, `UPDATE files SET uploaded_by_user_id='ffffffff-ffff-4fff-8fff-000000000004' WHERE id='${ids.fileProject}'`],
  ["fk_files_project", "files", `c.id='${ids.fileProject}'`, `UPDATE files SET project_id='ffffffff-ffff-4fff-8fff-000000000005' WHERE id='${ids.fileProject}'`],
  ["fk_files_ticket", "files", `c.id='${ids.fileTicket}'`, `UPDATE files SET ticket_id='ffffffff-ffff-4fff-8fff-000000000006' WHERE id='${ids.fileTicket}'`],
  ["fk_files_ticket_comment", "files", `c.id='${ids.fileComment}'`, `UPDATE files SET ticket_comment_id='ffffffff-ffff-4fff-8fff-000000000007' WHERE id='${ids.fileComment}'`],
  ["fk_files_task", "files", `c.id='${ids.fileTask}'`, `UPDATE files SET task_id='ffffffff-ffff-4fff-8fff-000000000008' WHERE id='${ids.fileTask}'`],
  ["fk_files_deliverable", "files", `c.id='${ids.fileDeliverable}'`, `UPDATE files SET deliverable_id='ffffffff-ffff-4fff-8fff-000000000009' WHERE id='${ids.fileDeliverable}'`],
  ["leads_service_id_fkey", "leads", `c.id='${ids.lead}'`, `UPDATE leads SET service_id='ffffffff-ffff-4fff-8fff-000000000010' WHERE id='${ids.lead}'`],
  ["leads_assigned_to_user_id_fkey", "leads", `c.id='${ids.lead}'`, `UPDATE leads SET assigned_to_user_id='ffffffff-ffff-4fff-8fff-000000000011' WHERE id='${ids.lead}'`],
  ["leads_converted_organization_id_fkey", "leads", `c.id='${ids.lead}'`, `UPDATE leads SET converted_organization_id='ffffffff-ffff-4fff-8fff-000000000012' WHERE id='${ids.lead}'`],
  ["organization_memberships_organization_id_fkey", "organization_memberships", `c.organization_id='${ids.organization}' AND c.user_id='${ids.user1}'`, `UPDATE organization_memberships SET organization_id='ffffffff-ffff-4fff-8fff-000000000013' WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`],
  ["organization_memberships_user_id_fkey", "organization_memberships", `c.organization_id='${ids.organization}' AND c.user_id='${ids.user1}'`, `UPDATE organization_memberships SET user_id='ffffffff-ffff-4fff-8fff-000000000014' WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`],
  ["fk_organization_memberships_organization_role", "organization_memberships", `c.organization_id='${ids.organization}' AND c.user_id='${ids.user1}'`, `UPDATE organization_memberships SET role_id='ffffffff-ffff-4fff-8fff-000000000015' WHERE organization_id='${ids.organization}' AND user_id='${ids.user1}'`],
  ["organizations_account_manager_user_id_fkey", "organizations", `c.id='${ids.organization}'`, `UPDATE organizations SET account_manager_user_id='ffffffff-ffff-4fff-8fff-000000000016' WHERE id='${ids.organization}'`],
  ["deliverables_approved_by_user_id_fkey", "deliverables", `c.id='${ids.deliverable}'`, `UPDATE deliverables SET approved_by_user_id='ffffffff-ffff-4fff-8fff-000000000017' WHERE id='${ids.deliverable}'`],
  ["fk_deliverables_project", "deliverables", `c.id='${ids.deliverable}'`, `UPDATE deliverables SET project_id='ffffffff-ffff-4fff-8fff-000000000018' WHERE id='${ids.deliverable}'`],
  ["project_members_user_id_fkey", "project_members", `c.project_id='${ids.project}' AND c.user_id='${ids.user1}'`, `UPDATE project_members SET user_id='ffffffff-ffff-4fff-8fff-000000000019' WHERE project_id='${ids.project}' AND user_id='${ids.user1}'`],
  ["project_members_assigned_by_user_id_fkey", "project_members", `c.project_id='${ids.project}' AND c.user_id='${ids.user1}'`, `UPDATE project_members SET assigned_by_user_id='ffffffff-ffff-4fff-8fff-000000000020' WHERE project_id='${ids.project}' AND user_id='${ids.user1}'`],
  ["fk_project_members_project", "project_members", `c.project_id='${ids.project}' AND c.user_id='${ids.user1}'`, `UPDATE project_members SET project_id='ffffffff-ffff-4fff-8fff-000000000021' WHERE project_id='${ids.project}' AND user_id='${ids.user1}'`],
  ["fk_project_members_project_role", "project_members", `c.project_id='${ids.project}' AND c.user_id='${ids.user1}'`, `UPDATE project_members SET role_id='ffffffff-ffff-4fff-8fff-000000000022' WHERE project_id='${ids.project}' AND user_id='${ids.user1}'`],
  ["fk_project_milestones_project", "project_milestones", `c.id='${ids.milestone}'`, `UPDATE project_milestones SET project_id='ffffffff-ffff-4fff-8fff-000000000023' WHERE id='${ids.milestone}'`],
  ["projects_organization_id_fkey", "projects", `c.id='${ids.project}'`, `UPDATE projects SET organization_id='ffffffff-ffff-4fff-8fff-000000000024' WHERE id='${ids.project}'`],
  ["projects_service_id_fkey", "projects", `c.id='${ids.project}'`, `UPDATE projects SET service_id='ffffffff-ffff-4fff-8fff-000000000025' WHERE id='${ids.project}'`],
  ["projects_lead_user_id_fkey", "projects", `c.id='${ids.project}'`, `UPDATE projects SET lead_user_id='ffffffff-ffff-4fff-8fff-000000000026' WHERE id='${ids.project}'`],
  ["projects_created_by_user_id_fkey", "projects", `c.id='${ids.project}'`, `UPDATE projects SET created_by_user_id='ffffffff-ffff-4fff-8fff-000000000027' WHERE id='${ids.project}'`],
  ["role_permissions_role_id_fkey", "role_permissions", `c.role_id=(SELECT id FROM roles WHERE scope='global' AND code='admin') AND c.permission_id=(SELECT id FROM permissions WHERE code='organizations.read')`, `UPDATE role_permissions SET role_id='ffffffff-ffff-4fff-8fff-000000000028' WHERE role_id=(SELECT id FROM roles WHERE scope='global' AND code='admin') AND permission_id=(SELECT id FROM permissions WHERE code='organizations.read')`],
  ["role_permissions_permission_id_fkey", "role_permissions", `c.role_id=(SELECT id FROM roles WHERE scope='global' AND code='admin') AND c.permission_id=(SELECT id FROM permissions WHERE code='organizations.read')`, `UPDATE role_permissions SET permission_id='ffffffff-ffff-4fff-8fff-000000000029' WHERE role_id=(SELECT id FROM roles WHERE scope='global' AND code='admin') AND permission_id=(SELECT id FROM permissions WHERE code='organizations.read')`],
  ["user_roles_user_id_fkey", "user_roles", `c.user_id='${ids.user1}'`, `UPDATE user_roles SET user_id='ffffffff-ffff-4fff-8fff-000000000030' WHERE user_id='${ids.user1}'`],
  ["user_roles_assigned_by_user_id_fkey", "user_roles", `c.user_id='${ids.user1}'`, `UPDATE user_roles SET assigned_by_user_id='ffffffff-ffff-4fff-8fff-000000000031' WHERE user_id='${ids.user1}'`],
  ["fk_user_roles_global_role", "user_roles", `c.user_id='${ids.user1}'`, `UPDATE user_roles SET role_id='ffffffff-ffff-4fff-8fff-000000000032' WHERE user_id='${ids.user1}'`],
  ["tasks_organization_id_fkey", "tasks", `c.id='${ids.taskProject}'`, `UPDATE tasks SET organization_id='ffffffff-ffff-4fff-8fff-000000000033' WHERE id='${ids.taskProject}'`],
  ["tasks_assigned_to_user_id_fkey", "tasks", `c.id='${ids.taskProject}'`, `UPDATE tasks SET assigned_to_user_id='ffffffff-ffff-4fff-8fff-000000000034' WHERE id='${ids.taskProject}'`],
  ["tasks_created_by_user_id_fkey", "tasks", `c.id='${ids.taskProject}'`, `UPDATE tasks SET created_by_user_id='ffffffff-ffff-4fff-8fff-000000000035' WHERE id='${ids.taskProject}'`],
  ["fk_tasks_project", "tasks", `c.id='${ids.taskProject}'`, `UPDATE tasks SET project_id='ffffffff-ffff-4fff-8fff-000000000036' WHERE id='${ids.taskProject}'`],
  ["fk_tasks_ticket", "tasks", `c.id='${ids.taskTicket}'`, `UPDATE tasks SET ticket_id='ffffffff-ffff-4fff-8fff-000000000037' WHERE id='${ids.taskTicket}'`],
  ["ticket_comments_author_user_id_fkey", "ticket_comments", `c.id='${ids.comment}'`, `UPDATE ticket_comments SET author_user_id='ffffffff-ffff-4fff-8fff-000000000038' WHERE id='${ids.comment}'`],
  ["fk_ticket_comments_ticket", "ticket_comments", `c.id='${ids.comment}'`, `UPDATE ticket_comments SET ticket_id='ffffffff-ffff-4fff-8fff-000000000039' WHERE id='${ids.comment}'`],
  ["tickets_organization_id_fkey", "tickets", `c.id='${ids.ticket}'`, `UPDATE tickets SET organization_id='ffffffff-ffff-4fff-8fff-000000000040' WHERE id='${ids.ticket}'`],
  ["tickets_requester_user_id_fkey", "tickets", `c.id='${ids.ticket}'`, `UPDATE tickets SET requester_user_id='ffffffff-ffff-4fff-8fff-000000000041' WHERE id='${ids.ticket}'`],
  ["tickets_assigned_to_user_id_fkey", "tickets", `c.id='${ids.ticket}'`, `UPDATE tickets SET assigned_to_user_id='ffffffff-ffff-4fff-8fff-000000000042' WHERE id='${ids.ticket}'`],
  ["fk_tickets_project", "tickets", `c.id='${ids.ticket}'`, `UPDATE tickets SET project_id='ffffffff-ffff-4fff-8fff-000000000043' WHERE id='${ids.ticket}'`],
].map(([name, table, where, invalid]) => ({ name, table, where, invalid }));

fkCases.find((item) => item.name === "projects_organization_id_fkey").beforeInvalid = `
  DELETE FROM files;
  DELETE FROM tasks;
  DELETE FROM ticket_comments;
  DELETE FROM tickets;
  DELETE FROM deliverables;
  DELETE FROM project_milestones;
  DELETE FROM project_members;
`;
fkCases.find((item) => item.name === "tasks_organization_id_fkey").beforeInvalid =
  `DELETE FROM files WHERE task_id='${ids.taskProject}'`;
fkCases.find((item) => item.name === "tickets_organization_id_fkey").beforeInvalid = `
  DELETE FROM files;
  DELETE FROM tasks WHERE ticket_id='${ids.ticket}';
  DELETE FROM ticket_comments WHERE ticket_id='${ids.ticket}';
`;

async function queryCatalog() {
  const tables = await client.query(
    `SELECT c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`,
    [schema],
  );
  const columns = await client.query(
    `SELECT c.table_name, c.column_name, c.ordinal_position, c.data_type,
            c.udt_name, c.character_maximum_length, c.numeric_precision,
            c.numeric_scale, c.is_nullable, c.column_default,
            a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
            pg_get_expr(ad.adbin, ad.adrelid) AS generation_expression
     FROM information_schema.columns c
     JOIN pg_namespace n ON n.nspname=c.table_schema
     JOIN pg_class cl ON cl.relnamespace=n.oid AND cl.relname=c.table_name
     JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attname=c.column_name
     LEFT JOIN pg_attrdef ad ON ad.adrelid=cl.oid AND ad.adnum=a.attnum
     WHERE c.table_schema=$1 ORDER BY c.table_name, c.ordinal_position`,
    [schema],
  );
  const constraints = await client.query(
    `SELECT con.conname AS name, child.relname AS table_name, con.contype,
            pg_get_constraintdef(con.oid, true) AS definition,
            parent.relname AS parent_table,
            con.confdeltype, con.confupdtype,
            ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum
                  ORDER BY k.ord)::text[] AS child_columns,
            ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.attnum
                  ORDER BY k.ord)::text[] AS parent_columns
     FROM pg_constraint con
     JOIN pg_class child ON child.oid=con.conrelid
     JOIN pg_namespace n ON n.oid=child.relnamespace
     LEFT JOIN pg_class parent ON parent.oid=con.confrelid
     WHERE n.nspname=$1 ORDER BY child.relname, con.conname`,
    [schema],
  );
  const indexes = await client.query(
    `SELECT idx.relname AS name, tbl.relname AS table_name,
            i.indisprimary, i.indisunique,
            con.contype AS constraint_type,
            pg_get_indexdef(idx.oid) AS definition,
            i.indpred IS NOT NULL AS is_partial,
            i.indexprs IS NOT NULL AS is_expression
     FROM pg_index i
     JOIN pg_class idx ON idx.oid=i.indexrelid
     JOIN pg_class tbl ON tbl.oid=i.indrelid
     JOIN pg_namespace n ON n.oid=tbl.relnamespace
     LEFT JOIN pg_constraint con ON con.conindid=idx.oid AND con.contype IN ('p', 'u')
     WHERE n.nspname=$1 ORDER BY idx.relname`,
    [schema],
  );
  return { tables: tables.rows, columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

function summarizeCatalog(catalog) {
  const constraintCounts = Object.groupBy(catalog.constraints, (item) => item.contype);
  const classifiedIndexes = catalog.indexes.map((index) => ({
    ...index,
    category: index.indisprimary
      ? "primary_key"
      : index.constraint_type === "u"
        ? "unique_constraint"
        : index.indisunique
          ? "explicit_unique_index"
          : "explicit_index",
  }));
  const indexGroups = Object.groupBy(classifiedIndexes, (item) => item.category);
  return {
    schemas: [schema],
    tableCount: catalog.tables.length,
    tableNames: catalog.tables.map((row) => row.name),
    columnCount: catalog.columns.length,
    primaryKeys: constraintCounts.p?.length ?? 0,
    uniqueConstraints: constraintCounts.u?.length ?? 0,
    foreignKeys: constraintCounts.f?.length ?? 0,
    checks: constraintCounts.c?.length ?? 0,
    identityColumns: catalog.columns.filter((column) => column.identity_kind !== "").map((column) => `${column.table_name}.${column.column_name}`),
    generatedColumns: catalog.columns.filter((column) => column.generated_kind !== "").map((column) => ({ name: `${column.table_name}.${column.column_name}`, expression: column.generation_expression })),
    physicalIndexes: classifiedIndexes.length,
    indexesByCategory: Object.fromEntries(
      Object.entries(indexGroups).map(([category, rows]) => [category, { count: rows.length, names: rows.map((row) => row.name) }]),
    ),
    partialIndexes: classifiedIndexes.filter((index) => index.is_partial).map((index) => index.name),
    expressionIndexes: classifiedIndexes.filter((index) => index.is_expression).map((index) => index.name),
  };
}

function compareCatalogToDrizzle(catalog) {
  const differences = [];
  const runtimeTables = new Map(catalog.tables.map((table) => [table.name, table]));
  const runtimeColumns = new Map(catalog.columns.map((column) => [`${column.table_name}.${column.column_name}`, column]));
  const expectedTables = Object.values(drizzleSnapshot.tables);

  const runtimeType = (column) => {
    if (column.data_type === "character varying") return `varchar(${column.character_maximum_length})`;
    if (column.data_type === "character") return `char(${column.character_maximum_length})`;
    return column.data_type;
  };
  const normalizeDefault = (value) => {
    if (value === undefined || value === null) return null;
    return String(value)
      .toLowerCase()
      .replaceAll("::character varying", "")
      .replaceAll("::text", "")
      .replaceAll(/\s+/g, "")
      .replaceAll(/[()]/g, "");
  };

  let expectedColumnCount = 0;
  for (const table of expectedTables) {
    if (!runtimeTables.has(table.name)) differences.push({ kind: "missing_table", table: table.name });
    for (const column of Object.values(table.columns)) {
      expectedColumnCount += 1;
      const actual = runtimeColumns.get(`${table.name}.${column.name}`);
      if (actual === undefined) {
        differences.push({ kind: "missing_column", table: table.name, column: column.name });
        continue;
      }
      if (runtimeType(actual) !== column.type) differences.push({ kind: "column_type", table: table.name, column: column.name, expected: column.type, actual: runtimeType(actual) });
      if ((actual.is_nullable === "NO") !== column.notNull) differences.push({ kind: "column_nullability", table: table.name, column: column.name, expected: column.notNull, actual: actual.is_nullable });
      if (normalizeDefault(actual.column_default) !== normalizeDefault(column.default)) differences.push({ kind: "column_default", table: table.name, column: column.name, expected: column.default ?? null, actual: actual.column_default });
      if ((actual.identity_kind !== "") !== (column.identity !== undefined)) differences.push({ kind: "column_identity", table: table.name, column: column.name });
      if ((actual.generated_kind !== "") !== (column.generated !== undefined)) differences.push({ kind: "column_generated", table: table.name, column: column.name });
    }
  }

  const actionName = (code) => ({ a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" })[code] ?? code;
  const fkKey = (table, columns, parent, parentColumns, onDelete, onUpdate) =>
    `${table}(${columns.join(",")})->${parent}(${parentColumns.join(",")}):${onDelete}:${onUpdate}`;
  const runtimeFks = new Map(
    catalog.constraints.filter((constraint) => constraint.contype === "f").map((constraint) => [
      fkKey(constraint.table_name, constraint.child_columns, constraint.parent_table, constraint.parent_columns, actionName(constraint.confdeltype), actionName(constraint.confupdtype)),
      constraint,
    ]),
  );
  const foreignKeyNameDifferences = [];
  for (const table of expectedTables) {
    for (const foreignKey of Object.values(table.foreignKeys)) {
      const key = fkKey(foreignKey.tableFrom, foreignKey.columnsFrom, foreignKey.tableTo, foreignKey.columnsTo, foreignKey.onDelete, foreignKey.onUpdate);
      const actual = runtimeFks.get(key);
      if (actual === undefined) differences.push({ kind: "foreign_key_structure", expected: key });
      else if (actual.name !== foreignKey.name) foreignKeyNameDifferences.push({ table: table.name, expectedByDrizzle: foreignKey.name, actualFromSql: actual.name });
    }
  }

  const runtimeUniqueByStructure = new Map(
    catalog.constraints.filter((constraint) => constraint.contype === "u").map((constraint) => [`${constraint.table_name}(${constraint.child_columns.join(",")})`, constraint]),
  );
  const uniqueNameDifferences = [];
  let expectedUniqueCount = 0;
  for (const table of expectedTables) {
    for (const unique of Object.values(table.uniqueConstraints)) {
      expectedUniqueCount += 1;
      const key = `${table.name}(${unique.columns.join(",")})`;
      const actual = runtimeUniqueByStructure.get(key);
      if (actual === undefined) differences.push({ kind: "unique_structure", expected: key });
      else if (actual.name !== unique.name) uniqueNameDifferences.push({ table: table.name, expectedByDrizzle: unique.name, actualFromSql: actual.name });
    }
  }

  const expectedCheckNames = expectedTables.flatMap((table) => Object.keys(table.checkConstraints)).toSorted();
  const actualCheckNames = catalog.constraints.filter((constraint) => constraint.contype === "c").map((constraint) => constraint.name).toSorted();
  const expectedIndexNames = expectedTables.flatMap((table) => Object.keys(table.indexes)).toSorted();
  const actualExplicitIndexNames = catalog.indexes.filter((index) => index.constraint_type === null).map((index) => index.name).toSorted();

  return {
    snapshot: DRIZZLE_SNAPSHOT,
    tablesCompared: expectedTables.length,
    columnsCompared: expectedColumnCount,
    structuralDifferences: differences,
    foreignKeysCompared: runtimeFks.size,
    foreignKeyNameDifferences,
    uniqueConstraintsCompared: expectedUniqueCount,
    uniqueNameDifferences,
    checkNamesMatch: JSON.stringify(expectedCheckNames) === JSON.stringify(actualCheckNames),
    indexesCompared: expectedIndexNames.length,
    explicitIndexNamesMatch: JSON.stringify(expectedIndexNames) === JSON.stringify(actualExplicitIndexNames),
    result: differences.length === 0 ? (foreignKeyNameDifferences.length === 0 && uniqueNameDifferences.length === 0 ? "exact" : "structural_match_with_name_drift") : "structural_drift",
  };
}

async function validateChecks() {
  const results = [];
  await client.query("BEGIN");
  try {
    await setupFixtures();
    for (let index = 0; index < checkCases.length; index += 1) {
      const item = checkCases[index];
      const savepoint = `check_${index}`;
      const validResult = await client.query(validByTable[item.table]);
      await client.query(`SAVEPOINT ${savepoint}`);
      let rejected = false;
      let actualConstraint = null;
      let errorCode = null;
      try {
        if (item.beforeInvalid !== undefined) await client.query(item.beforeInvalid);
        await client.query(item.invalid);
      } catch (error) {
        rejected = true;
        actualConstraint = error.constraint ?? null;
        errorCode = error.code ?? null;
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      results.push({
        constraint: item.name,
        table: item.table,
        validCase: validResult.rowCount === 1 ? "accepted" : "not_executed",
        invalidCase: rejected ? "rejected" : "accepted_unexpectedly",
        actualConstraint,
        errorCode,
        result: validResult.rowCount === 1 && rejected && actualConstraint === item.name ? "passed" : "failed",
      });
    }
  } finally {
    await client.query("ROLLBACK");
  }
  return results;
}

async function validateForeignKeys(catalog) {
  const fkCatalog = new Map(catalog.constraints.filter((item) => item.contype === "f").map((item) => [item.name, item]));
  const results = [];
  await client.query("BEGIN");
  try {
    await setupFixtures();
    for (let index = 0; index < fkCases.length; index += 1) {
      const item = fkCases[index];
      const metadata = fkCatalog.get(item.name);
      const validSavepoint = `fk_valid_${index}`;
      await client.query(`SAVEPOINT ${validSavepoint}`);
      let validAccepted = true;
      try {
        const firstColumn = metadata.child_columns[0];
        await client.query(`UPDATE ${quoteIdentifier(item.table)} c SET ${quoteIdentifier(firstColumn)}=c.${quoteIdentifier(firstColumn)} WHERE ${item.where}`);
      } catch {
        validAccepted = false;
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${validSavepoint}`);

      const invalidSavepoint = `fk_invalid_${index}`;
      await client.query(`SAVEPOINT ${invalidSavepoint}`);
      let invalidRejected = false;
      let invalidConstraint = null;
      try {
        if (item.beforeInvalid !== undefined) await client.query(item.beforeInvalid);
        await client.query(item.invalid);
      } catch (error) {
        invalidRejected = error.code === "23503";
        invalidConstraint = error.constraint ?? null;
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${invalidSavepoint}`);

      let deleteBehavior = "not_tested";
      let deleteBlockingConstraint = null;
      let deleteErrorCode = null;
      if (metadata.confdeltype === "r") {
        const deleteSavepoint = `fk_delete_${index}`;
        await client.query(`SAVEPOINT ${deleteSavepoint}`);
        const joins = metadata.parent_columns.map((parentColumn, columnIndex) => `p.${quoteIdentifier(parentColumn)}=c.${quoteIdentifier(metadata.child_columns[columnIndex])}`).join(" AND ");
        try {
          await client.query(`DELETE FROM ${quoteIdentifier(metadata.parent_table)} p USING ${quoteIdentifier(item.table)} c WHERE ${item.where} AND ${joins}`);
          deleteBehavior = "parent_deleted_unexpectedly";
        } catch (error) {
          deleteErrorCode = error.code ?? null;
          deleteBehavior = ["23001", "23503"].includes(error.code) ? "restricted" : "unexpected_error";
          deleteBlockingConstraint = error.constraint ?? null;
        }
        await client.query(`ROLLBACK TO SAVEPOINT ${deleteSavepoint}`);
      }

      let updateBehavior = "not_tested";
      if (metadata.confupdtype === "a" || metadata.confupdtype === "r") {
        const updateSavepoint = `fk_update_${index}`;
        await client.query(`SAVEPOINT ${updateSavepoint}`);
        const joins = metadata.parent_columns.map((parentColumn, columnIndex) => `p.${quoteIdentifier(parentColumn)}=c.${quoteIdentifier(metadata.child_columns[columnIndex])}`).join(" AND ");
        try {
          await client.query(
            `UPDATE ${quoteIdentifier(metadata.parent_table)} p SET ${quoteIdentifier(metadata.parent_columns[0])}=$1
             FROM ${quoteIdentifier(item.table)} c WHERE ${item.where} AND ${joins}`,
            [randomUUID()],
          );
          updateBehavior = "parent_updated_unexpectedly";
        } catch (error) {
          updateBehavior = error.code === "23503" ? "no_action_rejected" : "unexpected_error";
        }
        await client.query(`ROLLBACK TO SAVEPOINT ${updateSavepoint}`);
      }

      results.push({
        constraint: item.name,
        table: item.table,
        parentTable: metadata.parent_table,
        onDelete: metadata.confdeltype === "r" ? "RESTRICT" : metadata.confdeltype === "c" ? "CASCADE" : metadata.confdeltype,
        onUpdate: metadata.confupdtype === "a" ? "NO ACTION" : metadata.confupdtype,
        existingReference: validAccepted ? "accepted" : "failed",
        missingReference: invalidRejected ? "rejected" : "failed",
        missingReferenceConstraint: invalidConstraint,
        deleteBehavior,
        deleteErrorCode,
        deleteBlockingConstraint,
        updateBehavior,
        result:
          validAccepted && invalidRejected &&
          (metadata.confdeltype !== "r" || deleteBehavior === "restricted") &&
          updateBehavior === "no_action_rejected"
            ? "passed"
            : metadata.confdeltype === "c"
              ? "pending_cascade_specific_test"
              : "failed",
      });
    }

    const cascadeResults = [];
    for (const target of ["role", "permission"]) {
      const suffix = target === "role" ? "1" : "2";
      const roleId = `10000000-0000-4000-8000-00000000000${suffix}`;
      const permissionId = `20000000-0000-4000-8000-00000000000${suffix}`;
      await client.query(`INSERT INTO roles (id, scope, code, name) VALUES ($1, 'global', $2, 'Cascade test')`, [roleId, `cascade_role_${suffix}`]);
      await client.query(`INSERT INTO permissions (id, code, module, name) VALUES ($1, $2, 'runtime', 'Cascade test')`, [permissionId, `cascade.permission.${suffix}`]);
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, permissionId]);
      if (target === "role") await client.query(`DELETE FROM roles WHERE id=$1`, [roleId]);
      else await client.query(`DELETE FROM permissions WHERE id=$1`, [permissionId]);
      const childCount = await client.query(`SELECT count(*)::integer AS count FROM role_permissions WHERE role_id=$1 AND permission_id=$2`, [roleId, permissionId]);
      const survivor = await client.query(
        target === "role" ? `SELECT count(*)::integer AS count FROM permissions WHERE id=$1` : `SELECT count(*)::integer AS count FROM roles WHERE id=$1`,
        [target === "role" ? permissionId : roleId],
      );
      cascadeResults.push({
        constraint: target === "role" ? "role_permissions_role_id_fkey" : "role_permissions_permission_id_fkey",
        childRowsAfterDelete: childCount.rows[0].count,
        unrelatedParentRowsAfterDelete: survivor.rows[0].count,
        result: childCount.rows[0].count === 0 && survivor.rows[0].count === 1 ? "passed" : "failed",
      });
    }
    return { results, cascadeResults };
  } finally {
    await client.query("ROLLBACK");
  }
}

async function validateIdentityAndGenerated() {
  const results = {};
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO app_users (id, clerk_user_id, primary_email, status) VALUES ($1, 'identity_user', 'identity@example.test', 'active')`, [ids.user1]);
    await client.query(`INSERT INTO organizations (id, name, status) VALUES ($1, 'Identity organization', 'active')`, [ids.organization]);
    const insertTicket = async (id, year) => {
      const inserted = await client.query(
        `INSERT INTO tickets (id, organization_id, requester_user_id, ticket_year, type, subject, description)
         VALUES ($1, $2, $3, $4, 'incident', 'Identity test', 'Identity test')
         RETURNING ticket_number::text, ticket_year, code`,
        [id, ids.organization, ids.user1, year],
      );
      return inserted.rows[0];
    };
    await client.query(`ALTER TABLE tickets ALTER COLUMN ticket_number RESTART WITH 1`);
    const small = await insertTicket("30000000-0000-4000-8000-000000000001", 2026);
    await client.query(`ALTER TABLE tickets ALTER COLUMN ticket_number RESTART WITH 100000`);
    const sixDigits = await insertTicket("30000000-0000-4000-8000-000000000002", 2026);
    await client.query(`ALTER TABLE tickets ALTER COLUMN ticket_number RESTART WITH 1000001`);
    const overSixDigits = await insertTicket("30000000-0000-4000-8000-000000000003", 2026);
    const next = await insertTicket("30000000-0000-4000-8000-000000000004", 2028);
    let manualValueError = null;
    await client.query("SAVEPOINT manual_identity");
    try {
      await client.query(
        `INSERT INTO tickets (id, organization_id, requester_user_id, ticket_number, ticket_year, type, subject, description)
         VALUES ('30000000-0000-4000-8000-000000000005', $1, $2, 42, 2026, 'incident', 'Manual', 'Manual')`,
        [ids.organization, ids.user1],
      );
    } catch (error) {
      manualValueError = error.code ?? null;
    }
    await client.query("ROLLBACK TO SAVEPOINT manual_identity");
    const updated = await client.query(
      `UPDATE tickets SET ticket_year=2027 WHERE id='30000000-0000-4000-8000-000000000001' RETURNING code`,
    );
    results.small = small;
    results.sixDigits = sixDigits;
    results.overSixDigits = overSixDigits;
    results.incrementAfterOverSix = next;
    results.manualValueError = manualValueError;
    results.updatedSourceCode = updated.rows[0].code;
    results.result =
      small.code === "TCK-2026-000001" &&
      sixDigits.code === "TCK-2026-100000" &&
      overSixDigits.code === "TCK-2026-1000001" &&
      next.ticket_number === "1000002" &&
      manualValueError === "428C9" &&
      updated.rows[0].code === "TCK-2027-000001"
        ? "passed"
        : "failed";
  } finally {
    await client.query("ROLLBACK");
  }
  return results;
}

async function validateSeed() {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM roles) AS roles,
      (SELECT count(*)::integer FROM permissions) AS permissions,
      (SELECT count(*)::integer FROM role_permissions) AS associations,
      (SELECT count(*)::integer FROM (SELECT DISTINCT role_id, permission_id FROM role_permissions) d) AS distinct_associations,
      (SELECT count(*)::integer FROM role_permissions rp LEFT JOIN roles r ON r.id=rp.role_id WHERE r.id IS NULL) AS unknown_roles,
      (SELECT count(*)::integer FROM role_permissions rp LEFT JOIN permissions p ON p.id=rp.permission_id WHERE p.id IS NULL) AS unknown_permissions,
      (SELECT count(*)::integer FROM roles r WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id)) AS roles_without_permissions,
      (SELECT count(*)::integer FROM permissions p WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id=p.id)) AS permissions_without_roles
  `);
  const row = result.rows[0];
  return {
    ...row,
    duplicates: row.associations - row.distinct_associations,
    result:
      row.roles === 11 && row.permissions === 23 && row.associations === 142 &&
      row.distinct_associations === 142 && row.unknown_roles === 0 &&
      row.unknown_permissions === 0 && row.roles_without_permissions === 0 &&
      row.permissions_without_roles === 0
        ? "passed"
        : "failed",
  };
}

async function validateRollback() {
  const results = {};
  const insertedId = "40000000-0000-4000-8000-000000000001";
  await client.query("BEGIN");
  await client.query(`INSERT INTO app_users (id, clerk_user_id, primary_email) VALUES ($1, 'rollback_insert', 'rollback@example.test')`, [insertedId]);
  await client.query("ROLLBACK");
  results.insert = (await client.query(`SELECT count(*)::integer AS count FROM app_users WHERE id=$1`, [insertedId])).rows[0].count === 0;

  const beforeName = (await client.query(`SELECT name FROM roles WHERE scope='global' AND code='admin'`)).rows[0].name;
  await client.query("BEGIN");
  await client.query(`UPDATE roles SET name='Temporary rollback name' WHERE scope='global' AND code='admin'`);
  await client.query("ROLLBACK");
  results.update = (await client.query(`SELECT name FROM roles WHERE scope='global' AND code='admin'`)).rows[0].name === beforeName;

  const salesBefore = (await client.query(`SELECT count(*)::integer AS count FROM roles WHERE scope='global' AND code='sales'`)).rows[0].count;
  await client.query("BEGIN");
  await client.query(`DELETE FROM roles WHERE scope='global' AND code='sales'`);
  await client.query("ROLLBACK");
  results.delete = (await client.query(`SELECT count(*)::integer AS count FROM roles WHERE scope='global' AND code='sales'`)).rows[0].count === salesBefore;

  await client.query("BEGIN");
  await client.query(`INSERT INTO app_users (id, clerk_user_id, primary_email) VALUES ($1, 'rollback_multi', 'multi@example.test')`, [insertedId]);
  await client.query(`INSERT INTO organizations (id, name) VALUES ('40000000-0000-4000-8000-000000000002', 'Rollback multi')`);
  await client.query("ROLLBACK");
  const multi = await client.query(`SELECT (SELECT count(*) FROM app_users WHERE id=$1)::integer + (SELECT count(*) FROM organizations WHERE id='40000000-0000-4000-8000-000000000002')::integer AS count`, [insertedId]);
  results.multiTable = multi.rows[0].count === 0;
  results.result = Object.values(results).every(Boolean) ? "passed" : "failed";
  return results;
}

const output = {
  executedAt: new Date().toISOString(),
  status: "running",
  connection: {
    variable,
    host: parsedUrl.hostname,
    port: parsedUrl.port || "5432",
    database: parsedUrl.pathname.replace(/^\//, ""),
    credentialsExposed: false,
  },
  integrity: {
    expectedSha256: EXPECTED_HASH,
    original: { path: ORIGINAL_SQL, sha256: originalHash },
    baseline: { path: BASELINE_SQL, sha256: baselineHash },
    match: true,
  },
  temporarySchema: schema,
  cleanup: { attempted: false, removed: false, residualSchemaCount: null },
};

let schemaCreated = false;
try {
  await client.connect();
  const environment = await client.query(`
    SELECT current_setting('server_version') AS version,
           current_database() AS database,
           EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS pgcrypto_present,
           (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') AS public_tables
  `);
  output.connection.version = environment.rows[0].version;
  output.connection.publicTablesBefore = environment.rows[0].public_tables;
  output.connection.pgcryptoPresentBefore = environment.rows[0].pgcrypto_present;
  await client.query(`CREATE SCHEMA ${qs}`);
  schemaCreated = true;
  await client.query(`SET search_path TO ${qs}, public`);
  const started = performance.now();
  await client.query(originalSql);
  output.sqlApplication = {
    result: "passed",
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    notices,
  };
  const catalog = await queryCatalog();
  output.catalog = summarizeCatalog(catalog);
  output.drizzleParity = compareCatalogToDrizzle(catalog);
  output.seed = await validateSeed();
  output.checks = await validateChecks();
  output.foreignKeys = await validateForeignKeys(catalog);
  output.identityAndGenerated = await validateIdentityAndGenerated();
  output.rollback = await validateRollback();
  const residual = await client.query(`
    SELECT
      (SELECT count(*) FROM app_users)::integer +
      (SELECT count(*) FROM organizations)::integer +
      (SELECT count(*) FROM services)::integer +
      (SELECT count(*) FROM leads)::integer +
      (SELECT count(*) FROM projects)::integer +
      (SELECT count(*) FROM tickets)::integer +
      (SELECT count(*) FROM tasks)::integer +
      (SELECT count(*) FROM files)::integer +
      (SELECT count(*) FROM audit_events)::integer AS count
  `);
  output.residualTestRowsBeforeSchemaDrop = residual.rows[0].count;
  output.status = "completed";
} catch (error) {
  output.status = "failed";
  output.error = {
    code: error.code ?? null,
    constraint: error.constraint ?? null,
    message: error.message,
  };
} finally {
  if (schemaCreated) {
    output.cleanup.attempted = true;
    try {
      await client.query(`SET search_path TO public`);
      await client.query(`DROP SCHEMA ${qs} CASCADE`);
      output.cleanup.removed = true;
      const remaining = await client.query(`SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname=$1`, [schema]);
      output.cleanup.residualSchemaCount = remaining.rows[0].count;
    } catch (cleanupError) {
      output.cleanup.errorCode = cleanupError.code ?? null;
    }
  }
  await client.end().catch(() => undefined);
}

console.log(JSON.stringify(output, null, 2));
if (output.status !== "completed" || !output.cleanup.removed) process.exitCode = 1;
