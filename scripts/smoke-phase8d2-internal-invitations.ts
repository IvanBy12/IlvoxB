import { randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";
import type { ClerkInvitationGateway, VerifiedClerkUser } from "../src/modules/client-invitations/client-invitation.types.js";
import { PostgresClientInvitationRepository } from "../src/modules/client-invitations/client-invitation.repository.js";
import { PostgresInternalInvitationRepository } from "../src/modules/internal-invitations/internal-invitation.repository.js";

const PREFIX = "PHASE8D2_SMOKE_";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("PHASE8D2_SMOKE_REQUIRES_LOCAL_POSTGRESQL");

const marker = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
const ids = {
  owner: randomUUID(), newUser: randomUUID(), existing: randomUUID(), dual: randomUUID(), blocked: randomUUID(), deleted: randomUUID(),
  organization: randomUUID(), clientInvitation: randomUUID(),
};
const clerkIds = {
  owner: `${marker}_owner`, newUser: `${marker}_new`, existing: `${marker}_existing`, dual: `${marker}_dual`,
  expired: `${marker}_expired`, revoked: `${marker}_revoked`, blocked: `${marker}_blocked`, deleted: `${marker}_deleted`, mismatch: `${marker}_mismatch`,
};
const emails = {
  owner: `${marker}_owner@example.test`, newUser: `${marker}_new@example.test`, existing: `${marker}_existing@example.test`,
  dual: `${marker}_dual@example.test`, expired: `${marker}_expired@example.test`, revoked: `${marker}_revoked@example.test`,
  resend: `${marker}_resend@example.test`, client: `${marker}_client@example.test`, blocked: `${marker}_blocked@example.test`,
  deleted: `${marker}_deleted@example.test`, mismatch: `${marker}_mismatch@example.test`,
};
const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8d2-smoke" });

class SmokeClerkGateway implements ClerkInvitationGateway {
  readonly verified = new Map<string, VerifiedClerkUser>();
  readonly emails = new Map<string, readonly string[]>();
  readonly revoked = new Set<string>();
  readonly created: { readonly id: string; readonly email: string; readonly redirectUrl: string }[] = [];
  private sequence = 0;
  findVerifiedUserByEmail(normalizedEmail: string) { return Promise.resolve(this.verified.get(normalizedEmail) ?? null); }
  getVerifiedEmails(clerkUserId: string) { return Promise.resolve(this.emails.get(clerkUserId) ?? []); }
  createInvitation(input: { readonly email: string; readonly redirectUrl: string; readonly expiresInDays: number }) {
    this.sequence += 1;
    const record = { id: `${marker}_inv_${this.sequence}`, email: input.email, redirectUrl: input.redirectUrl };
    this.created.push(record);
    return Promise.resolve({ id: record.id });
  }
  revokeInvitation(clerkInvitationId: string) { this.revoked.add(clerkInvitationId); return Promise.resolve(); }
}

const gateway = new SmokeClerkGateway();
const authenticationProvider: AuthenticationProvider = {
  authenticate: (request) => {
    const value = request.headers["x-phase8d2-smoke-user"];
    return Promise.resolve(typeof value === "string" ? { clerkUserId: value } : null);
  },
};
const app = await buildApp({
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "3007", LOG_LEVEL: "silent", TRUST_PROXY: "false", CORS_ORIGINS: "http://127.0.0.1:5173", RATE_LIMIT_MAX: "1000", CLERK_AUTH_ENABLED: "false", CLERK_WEBHOOKS_ENABLED: "false", CLERK_SECRET_KEY: "" },
  logger: false,
  authenticationProvider,
  internalInvitationRepository: new PostgresInternalInvitationRepository(pool),
  internalClerkInvitationGateway: gateway,
  clientInvitationRepository: new PostgresClientInvitationRepository(pool),
  clerkInvitationGateway: gateway,
});

type Response = { readonly statusCode: number; json<T>(): T };
const headers = (clerkUserId: string) => ({ "x-phase8d2-smoke-user": clerkUserId, "user-agent": "phase8d2-smoke" });
const data = <T>(response: Response): T => response.json<{ data: T }>().data;
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); }
function status(response: Response, expected: number, label: string) { assert(response.statusCode === expected, `${label}_EXPECTED_${expected}_GOT_${response.statusCode}_${JSON.stringify(response.json())}`); }
async function post(url: string, payload: object | undefined, actor = clerkIds.owner) {
  return app.inject({ method: "POST", url, headers: headers(actor), ...(payload === undefined ? {} : { payload }) });
}

async function cleanup() {
  const userIds = [ids.owner, ids.newUser, ids.existing, ids.dual, ids.blocked, ids.deleted];
  await pool.query("BEGIN");
  try {
    await pool.query("DELETE FROM audit_events WHERE user_agent='phase8d2-smoke' OR actor_user_id=ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM internal_user_invitations WHERE normalized_email LIKE $1", [`${PREFIX.toLowerCase()}%`]);
    await pool.query("DELETE FROM organization_invitations WHERE normalized_email LIKE $1", [`${PREFIX.toLowerCase()}%`]);
    await pool.query("DELETE FROM organization_memberships WHERE organization_id=$1", [ids.organization]);
    await pool.query("DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM organizations WHERE id=$1", [ids.organization]);
    await pool.query("DELETE FROM app_users WHERE id=ANY($1::uuid[])", [userIds]);
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
    `INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status) VALUES
     ($1,$2,$3,'Owner','active'),($4,$5,$6,'Existing','active'),($7,$8,$9,'Dual','active')`,
    [ids.owner, clerkIds.owner, emails.owner, ids.existing, clerkIds.existing, emails.existing, ids.dual, clerkIds.dual, emails.dual],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope)
     SELECT $1,r.id,'global' FROM roles r WHERE r.scope='global' AND r.code='super_admin'`,
    [ids.owner],
  );
  await pool.query("INSERT INTO organizations (id,name,status,account_manager_user_id) VALUES ($1,$2,'active',$3)", [ids.organization, `${marker}_ORG`, ids.owner]);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id,user_id,role_id,role_scope,status,activated_at)
     SELECT $1,$2,r.id,'organization','active',now() FROM roles r WHERE r.scope='organization' AND r.code='client_contact'`,
    [ids.organization, ids.dual],
  );
  gateway.verified.set(emails.existing.toLowerCase(), { clerkUserId: clerkIds.existing, verifiedEmails: [emails.existing] });
  gateway.verified.set(emails.dual.toLowerCase(), { clerkUserId: clerkIds.dual, verifiedEmails: [emails.dual] });
  gateway.emails.set(clerkIds.existing, [emails.existing]);
  gateway.emails.set(clerkIds.dual, [emails.dual]);

  const rolesResponse = await app.inject({ method: "GET", url: "/api/v1/internal-roles", headers: headers(clerkIds.owner) });
  status(rolesResponse, 200, "ROLES");
  const roles = data<readonly { readonly code: string }[]>(rolesResponse);
  assert(roles.some((role) => role.code === "contributor"), "CONTRIBUTOR_NOT_ASSIGNABLE");
  assert(!roles.some((role) => ["super_admin", "client_manager", "client_contact"].includes(role.code)), "PRIVILEGED_OR_CLIENT_ROLE_EXPOSED");

  const newInviteResponse = await post("/api/v1/internal-invitations", { email: emails.newUser, roleCode: "contributor" });
  status(newInviteResponse, 201, "NEW_INVITE");
  const newInvite = data<{ readonly invitation: { readonly id: string }; readonly outcome: string }>(newInviteResponse);
  assert(newInvite.outcome === "invitation_sent", "NEW_INVITATION_OUTCOME");
  const redirect = new URL(gateway.created.at(-1)!.redirectUrl);
  assert(redirect.searchParams.get("ilvox_internal_invitation") === newInvite.invitation.id, "INTERNAL_REDIRECT_MISSING");
  assert(!redirect.searchParams.has("ilvox_invitation"), "CLIENT_REDIRECT_MIXED");

  await pool.query("INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status) VALUES ($1,$2,$3,'New','pending')", [ids.newUser, clerkIds.newUser, emails.newUser]);
  gateway.emails.set(clerkIds.newUser, [emails.newUser]);
  const claimResponse = await post("/api/v1/internal-invitations/claim", { invitationId: newInvite.invitation.id }, clerkIds.newUser);
  status(claimResponse, 200, "NEW_CLAIM");
  assert(data<{ readonly audience: string }>(claimResponse).audience === "internal", "CLAIM_AUDIENCE");
  const repeatedClaim = await post("/api/v1/internal-invitations/claim", { invitationId: newInvite.invitation.id }, clerkIds.newUser);
  status(repeatedClaim, 200, "IDEMPOTENT_CLAIM");
  assert(data<{ readonly alreadyClaimed: boolean }>(repeatedClaim).alreadyClaimed, "CLAIM_NOT_IDEMPOTENT");
  gateway.emails.set(clerkIds.mismatch, [`${marker}_other@example.test`]);
  status(await post("/api/v1/internal-invitations/claim", { invitationId: newInvite.invitation.id }, clerkIds.mismatch), 409, "CLAIM_USED_BY_OTHER_IDENTITY");
  const me = await app.inject({ method: "GET", url: "/me", headers: headers(clerkIds.newUser) });
  status(me, 200, "NEW_ME");
  assert(data<{ readonly user: { readonly internal: boolean } }>(me).user.internal, "NEW_USER_NOT_INTERNAL");

  for (const [email, label] of [[emails.existing, "EXISTING"], [emails.dual, "DUAL"]] as const) {
    const response = await post("/api/v1/internal-invitations", { email, roleCode: "contributor" });
    status(response, 201, label);
    assert(data<{ readonly outcome: string }>(response).outcome === "existing_account_granted", `${label}_NOT_GRANTED`);
  }
  const dualMembership = await pool.query("SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'", [ids.organization, ids.dual]);
  assert(dualMembership.rowCount === 1, "DUAL_CLIENT_MEMBERSHIP_LOST");
  const dualInternal = await pool.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.scope='global' WHERE ur.user_id=$1", [ids.dual]);
  assert(dualInternal.rowCount === 1, "DUAL_INTERNAL_ROLE_MISSING");

  for (const roleCode of ["client_contact", "super_admin"]) {
    status(await post("/api/v1/internal-invitations", { email: `${marker}_${roleCode}@example.test`, roleCode }), 400, `ROLE_${roleCode}`);
  }

  const expiredResponse = await post("/api/v1/internal-invitations", { email: emails.expired, roleCode: "contributor" });
  const expiredId = data<{ readonly invitation: { readonly id: string } }>(expiredResponse).invitation.id;
  await pool.query("UPDATE internal_user_invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1", [expiredId]);
  gateway.emails.set(clerkIds.expired, [emails.expired]);
  status(await post("/api/v1/internal-invitations/claim", { invitationId: expiredId }, clerkIds.expired), 409, "EXPIRED");

  for (const [profileId, clerkUserId, email, profileStatus] of [
    [ids.blocked, clerkIds.blocked, emails.blocked, "blocked"],
    [ids.deleted, clerkIds.deleted, emails.deleted, "deleted"],
  ] as const) {
    const response = await post("/api/v1/internal-invitations", { email, roleCode: "contributor" });
    const invitationId = data<{ readonly invitation: { readonly id: string } }>(response).invitation.id;
    await pool.query("INSERT INTO app_users (id,clerk_user_id,primary_email,first_name,status) VALUES ($1,$2,$3,'Inactive',$4)", [profileId, clerkUserId, email, profileStatus]);
    gateway.emails.set(clerkUserId, [email]);
    status(await post("/api/v1/internal-invitations/claim", { invitationId }, clerkUserId), 403, `PROFILE_${profileStatus}`);
  }
  const mismatchResponse = await post("/api/v1/internal-invitations", { email: emails.mismatch, roleCode: "contributor" });
  const mismatchId = data<{ readonly invitation: { readonly id: string } }>(mismatchResponse).invitation.id;
  status(await post("/api/v1/internal-invitations/claim", { invitationId: mismatchId }, clerkIds.mismatch), 403, "EMAIL_MISMATCH");

  const revokeResponse = await post("/api/v1/internal-invitations", { email: emails.revoked, roleCode: "contributor" });
  const revokedId = data<{ readonly invitation: { readonly id: string } }>(revokeResponse).invitation.id;
  status(await post(`/api/v1/internal-invitations/${revokedId}/revoke`, undefined), 200, "REVOKE");
  status(await post(`/api/v1/internal-invitations/${revokedId}/revoke`, undefined), 200, "REVOKE_IDEMPOTENT");
  gateway.emails.set(clerkIds.revoked, [emails.revoked]);
  status(await post("/api/v1/internal-invitations/claim", { invitationId: revokedId }, clerkIds.revoked), 409, "REVOKED_CLAIM");

  const resendResponse = await post("/api/v1/internal-invitations", { email: emails.resend, roleCode: "contributor" });
  const originalResend = data<{ readonly invitation: { readonly id: string } }>(resendResponse).invitation.id;
  const oldClerkId = gateway.created.at(-1)!.id;
  const resent = await post(`/api/v1/internal-invitations/${originalResend}/resend`, undefined);
  status(resent, 200, "RESEND");
  assert(data<{ readonly id: string }>(resent).id !== originalResend, "RESEND_DID_NOT_PRESERVE_HISTORY");
  assert(gateway.revoked.has(oldClerkId), "OLD_CLERK_LINK_NOT_REVOKED");

  await pool.query(
    `INSERT INTO organization_invitations
       (id,organization_id,email,normalized_email,membership_role,status,invited_by_user_id,expires_at)
     VALUES ($1,$2,$3::varchar(320),lower(btrim($3::varchar(320))),'client_contact','pending',$4,now()+interval '30 days')`,
    [ids.clientInvitation, ids.organization, emails.client, ids.owner],
  );
  status(await post("/api/v1/client-invitations/claim", { invitationId: newInvite.invitation.id }, clerkIds.newUser), 404, "INTERNAL_TO_CLIENT_CLAIM");
  status(await post("/api/v1/internal-invitations/claim", { invitationId: ids.clientInvitation }, clerkIds.newUser), 404, "CLIENT_TO_INTERNAL_CLAIM");

  const audit = await pool.query<{ readonly action: string }>(
    "SELECT action FROM audit_events WHERE user_agent='phase8d2-smoke'",
  );
  const actions = new Set(audit.rows.map((row) => row.action));
  for (const action of ["internal_user.invited", "internal_user.invitation_resent", "internal_user.invitation_revoked", "internal_user.invitation_accepted", "internal_user.existing_account_granted", "internal_user.role_granted"]) {
    assert(actions.has(action), `AUDIT_${action}_MISSING`);
  }
  console.log(JSON.stringify({
    marker, newInvitation: true, claim: true, internalRole: true, meInternal: true,
    existingAccount: true, dualIdentity: true, clientRoleRejected: true, privilegedRoleRejected: true,
    expiration: true, blockedAndDeletedRejected: true, emailMismatch: true, usedByOtherRejected: true, revoke: true, resend: true, idempotency: true, audit: true,
    clientSeparation: true, healthLive: 200, healthReady: 200, meWithoutToken: 401,
  }));
} catch (error) {
  smokeError = error;
} finally {
  await cleanup().catch((error) => { if (smokeError === undefined) smokeError = error; });
  const residual = await pool.query<{ readonly total: number }>(
    `SELECT ((SELECT count(*) FROM app_users WHERE primary_email LIKE $1) +
             (SELECT count(*) FROM organizations WHERE name LIKE $1) +
             (SELECT count(*) FROM internal_user_invitations WHERE normalized_email LIKE $2) +
             (SELECT count(*) FROM organization_invitations WHERE normalized_email LIKE $2) +
             (SELECT count(*) FROM audit_events WHERE user_agent='phase8d2-smoke'))::int AS total`,
    [`${PREFIX}%`, `${PREFIX.toLowerCase()}%`],
  ).catch(() => ({ rows: [{ total: -1 }] }));
  console.log(JSON.stringify({ residualFixtures: residual.rows[0]?.total ?? -1 }));
  await app.close();
  await pool.end();
}
if (smokeError !== undefined) throw smokeError instanceof Error ? smokeError : new Error("PHASE8D2_SMOKE_FAILED", { cause: smokeError });
