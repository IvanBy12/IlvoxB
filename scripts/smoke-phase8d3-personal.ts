import { randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { PostgresIdentityRepository } from "../src/modules/identity/identity.repository.js";
import { PostgresUserCatalogRepository } from "../src/modules/users/user-catalog.repository.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";

const PREFIX = "PHASE8D3_SMOKE_";
const marker = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
const schema = marker.toLowerCase();
if (!/^phase8d3_smoke_[a-f0-9]{32}$/.test(schema)) throw new Error("UNSAFE_SMOKE_SCHEMA");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_MISSING");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("PHASE8D3_SMOKE_REQUIRES_LOCAL_POSTGRESQL");

const rootPool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8d3-smoke-root" });
const isolatedPool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8d3-smoke", options: `-c search_path=${schema}` });
const ids = { owner: randomUUID(), collaborator: randomUUID(), pending: randomUUID(), client: randomUUID(), organization: randomUUID(), adminRole: randomUUID(), contributorRole: randomUUID(), projectLeadRole: randomUUID(), clientRole: randomUUID(), superRole: randomUUID(), dangerousRole: randomUUID(), usersManage: randomUUID(), tasksManage: randomUUID(), projectsRead: randomUUID(), securityManage: randomUUID() };
const clerk = { owner: `${marker}_owner`, collaborator: `${marker}_collaborator`, pending: `${marker}_pending`, client: `${marker}_client` };

async function createSchema() {
  await rootPool.query(`CREATE SCHEMA "${schema}"`);
  await rootPool.query(`SET search_path TO "${schema}";
    CREATE TABLE app_users (id uuid PRIMARY KEY, clerk_user_id varchar(255) UNIQUE NOT NULL, primary_email varchar(320) NOT NULL, first_name varchar(120), last_name varchar(120), avatar_url text, status varchar(20) NOT NULL, last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE roles (id uuid PRIMARY KEY, scope varchar(20) NOT NULL, code varchar(64) NOT NULL, name varchar(120) NOT NULL, description text, UNIQUE(scope,code));
    CREATE TABLE permissions (id uuid PRIMARY KEY, code varchar(100) UNIQUE NOT NULL);
    CREATE TABLE role_permissions (role_id uuid NOT NULL, permission_id uuid NOT NULL, PRIMARY KEY(role_id,permission_id));
    CREATE TABLE user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL, role_scope varchar(20) NOT NULL, assigned_by_user_id uuid, assigned_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,role_id));
    CREATE TABLE organizations (id uuid PRIMARY KEY, status varchar(20) NOT NULL);
    CREATE TABLE organization_memberships (organization_id uuid NOT NULL, user_id uuid NOT NULL, role_id uuid NOT NULL, role_scope varchar(20) NOT NULL, status varchar(20) NOT NULL, PRIMARY KEY(organization_id,user_id));
    CREATE TABLE projects (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
    CREATE TABLE project_members (project_id uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid NOT NULL, role_id uuid NOT NULL, status varchar(20) NOT NULL);
    CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, organization_id uuid, action varchar(120) NOT NULL, entity_type varchar(80) NOT NULL, entity_id uuid, old_values jsonb, new_values jsonb, ip_address inet, user_agent varchar(1000), request_id uuid NOT NULL, created_at timestamptz DEFAULT now());`);
  await rootPool.query("RESET search_path");
  await isolatedPool.query(
    `INSERT INTO roles (id,scope,code,name) VALUES
      ($1,'global','admin','Administrador'),($2,'global','contributor','Colaborador'),
      ($3,'global','project_lead','Líder'),($4,'organization','client_contact','Contacto cliente'),
      ($5,'global','super_admin','Superadministrador'),($6,'global','dangerous_role','Privilegiado')`,
    [ids.adminRole, ids.contributorRole, ids.projectLeadRole, ids.clientRole, ids.superRole, ids.dangerousRole],
  );
  await isolatedPool.query("INSERT INTO permissions (id,code) VALUES ($1,'users.manage'),($2,'tasks.manage'),($3,'projects.read'),($4,'security.manage')", [ids.usersManage, ids.tasksManage, ids.projectsRead, ids.securityManage]);
  await isolatedPool.query(
    `INSERT INTO role_permissions (role_id,permission_id) VALUES
      ($1,$7),($1,$8),($1,$9),($2,$8),($2,$9),($3,$8),($3,$9),($4,$9),($5,$7),($5,$8),($5,$9),($5,$10),($6,$10)`,
    [ids.adminRole, ids.contributorRole, ids.projectLeadRole, ids.clientRole, ids.superRole, ids.dangerousRole, ids.usersManage, ids.tasksManage, ids.projectsRead, ids.securityManage],
  );
}

async function dropSchema() {
  await isolatedPool.end().catch(() => undefined);
  await rootPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

const authenticationProvider: AuthenticationProvider = { authenticate: (request) => {
  const value = request.headers["x-phase8d3-smoke-user"];
  return Promise.resolve(typeof value === "string" ? { clerkUserId: value } : null);
} };
type SmokeResponse = { readonly statusCode: number; json<T>(): T };
const headers = (clerkUserId = clerk.owner) => ({ "x-phase8d3-smoke-user": clerkUserId, "user-agent": "phase8d3-smoke" });
const data = <T>(response: SmokeResponse): T => response.json<{ data: T }>().data;
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); }
function status(response: SmokeResponse, expected: number, label: string) { assert(response.statusCode === expected, `${label}_EXPECTED_${expected}_GOT_${response.statusCode}_${JSON.stringify(response.json())}`); }

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let smokeError: unknown;
try {
  await createSchema();
  await isolatedPool.query("INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status,last_synced_at) VALUES ($1,$2,$3,'Owner','active',now())", [ids.owner, clerk.owner, `${marker}_owner@example.test`]);
  await isolatedPool.query("INSERT INTO user_roles (user_id,role_id,role_scope) VALUES ($1,$2,'global')", [ids.owner, ids.adminRole]);
  app = await buildApp({ env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "3008", LOG_LEVEL: "silent", TRUST_PROXY: "false", CORS_ORIGINS: "http://127.0.0.1:5173", RATE_LIMIT_MAX: "1000", CLERK_AUTH_ENABLED: "false", CLERK_WEBHOOKS_ENABLED: "false", CLERK_SECRET_KEY: "", FILE_STORAGE_PROVIDER: "disabled" }, logger: false, authenticationProvider, identityRepository: new PostgresIdentityRepository(isolatedPool), userCatalogRepository: new PostgresUserCatalogRepository(isolatedPool) });
  status(await app.inject({ method: "GET", url: "/health/live" }), 200, "HEALTH_LIVE");
  status(await app.inject({ method: "GET", url: "/health/ready" }), 200, "HEALTH_READY");
  status(await app.inject({ method: "GET", url: "/me" }), 401, "ME_UNAUTHENTICATED");

  const unique = await app.inject({ method: "GET", url: "/api/v1/users?type=internal", headers: headers() });
  status(unique, 200, "UNIPERSONAL_LIST");
  assert(data<{ readonly pagination: { readonly total: number } }>(unique).pagination.total === 1, "UNIPERSONAL_NOT_ONE");
  const protectedBlock = await app.inject({ method: "POST", url: `/api/v1/users/${ids.owner}/block`, headers: headers() });
  status(protectedBlock, 409, "LAST_ADMIN_BLOCK");
  assert(protectedBlock.json<{ error: { code: string } }>().error.code === "LAST_ADMINISTRATOR_PROTECTED", "LAST_ADMIN_CODE");
  status(await app.inject({ method: "DELETE", url: `/api/v1/users/${ids.owner}/roles/admin`, headers: headers() }), 409, "LAST_ADMIN_ROLE");

  await isolatedPool.query(`INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status,last_synced_at) VALUES
    ($1,$2,$3,'Collaborator','active',now()),($4,$5,$6,'Pending','pending',now()),($7,$8,$9,'Client','active',now())`,
  [ids.collaborator, clerk.collaborator, `${marker}_collaborator@example.test`, ids.pending, clerk.pending, `${marker}_pending@example.test`, ids.client, clerk.client, `${marker}_client@example.test`]);
  await isolatedPool.query("INSERT INTO user_roles (user_id,role_id,role_scope,assigned_by_user_id) VALUES ($1,$2,'global',$3),($4,$2,'global',$3)", [ids.collaborator, ids.contributorRole, ids.owner, ids.pending]);
  await isolatedPool.query("INSERT INTO organizations (id,status) VALUES ($1,'active')", [ids.organization]);
  await isolatedPool.query("INSERT INTO organization_memberships (organization_id,user_id,role_id,role_scope,status) VALUES ($1,$2,$3,'organization','active'),($1,$4,$3,'organization','active')", [ids.organization, ids.collaborator, ids.clientRole, ids.client]);

  const detail = await app.inject({ method: "GET", url: `/api/v1/users/${ids.collaborator}`, headers: headers() });
  status(detail, 200, "DETAIL");
  const detailData = data<{ readonly hasClientAccess: boolean; readonly effectivePermissions: readonly string[] }>(detail);
  assert(detailData.hasClientAccess && detailData.effectivePermissions.includes("tasks.manage"), "DUAL_OR_PERMISSIONS_MISSING");
  status(await app.inject({ method: "GET", url: `/api/v1/users/${ids.client}`, headers: headers() }), 404, "CLIENT_NEUTRAL");

  const eligible = () => app!.inject({ method: "GET", url: "/api/v1/users/eligible?purpose=task_assignee", headers: headers() });
  assert(data<{ items: readonly { id: string }[] }>(await eligible()).items.some((item) => item.id === ids.collaborator), "ELIGIBLE_BEFORE_BLOCK");
  status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.collaborator}/block`, headers: headers() }), 200, "BLOCK");
  assert(!data<{ items: readonly { id: string }[] }>(await eligible()).items.some((item) => item.id === ids.collaborator), "ELIGIBLE_AFTER_BLOCK");
  status(await app.inject({ method: "GET", url: "/me", headers: headers(clerk.collaborator) }), 403, "BLOCKED_ME");
  status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.collaborator}/block`, headers: headers() }), 200, "BLOCK_IDEMPOTENT");
  status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.collaborator}/activate`, headers: headers() }), 200, "REACTIVATE");
  assert(data<{ items: readonly { id: string }[] }>(await eligible()).items.some((item) => item.id === ids.collaborator), "ELIGIBLE_AFTER_REACTIVATE");
  status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.pending}/activate`, headers: headers() }), 200, "ACTIVATE_PENDING");

  status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.collaborator}/roles`, headers: headers(), payload: { roleCode: "project_lead" } }), 200, "GRANT_ROLE");
  status(await app.inject({ method: "DELETE", url: `/api/v1/users/${ids.collaborator}/roles/project_lead`, headers: headers() }), 200, "REVOKE_ROLE");
  for (const roleCode of ["client_contact", "missing_role", "dangerous_role"]) status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.collaborator}/roles`, headers: headers(), payload: { roleCode } }), 400, `REJECT_${roleCode}`);
  status(await app.inject({ method: "POST", url: `/api/v1/users/${ids.collaborator}/roles`, headers: headers(), payload: { roleCode: "super_admin" } }), 409, "SUPER_ADMIN_PROTECTED");

  const audit = await isolatedPool.query<{ readonly action: string }>("SELECT action FROM audit_events WHERE user_agent='phase8d3-smoke'");
  const actions = new Set(audit.rows.map((row) => row.action));
  for (const action of ["internal_user.activated", "internal_user.blocked", "internal_user.reactivated", "internal_user.role_granted", "internal_user.role_revoked"]) assert(actions.has(action), `AUDIT_${action}_MISSING`);
  console.log(JSON.stringify({ marker, unipersonal: true, collaborator: true, roles: true, effectivePermissions: true, blocked: true, eligibleExcluded: true, reactivated: true, eligibleRecovered: true, lastAdministratorProtected: true, dualIdentity: true, audit: true, healthLive: 200, healthReady: 200, meWithoutToken: 401 }));
} catch (error) {
  smokeError = error;
} finally {
  await app?.close().catch(() => undefined);
  await dropSchema().catch((error) => { if (smokeError === undefined) smokeError = error; });
  const residual = await rootPool.query<{ readonly total: number }>("SELECT count(*)::int AS total FROM pg_namespace WHERE nspname=$1", [schema]).catch(() => ({ rows: [{ total: -1 }] }));
  console.log(JSON.stringify({ residualFixtures: residual.rows[0]?.total ?? -1 }));
  await rootPool.end();
}
if (smokeError !== undefined) throw smokeError instanceof Error ? smokeError : new Error("PHASE8D3_SMOKE_FAILED", { cause: smokeError });
