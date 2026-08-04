import { randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { AuthorizationService } from "../src/common/auth/authorization.service.js";
import type { ActorContext } from "../src/common/auth/authorization.types.js";
import { PostgresIdentityRepository } from "../src/modules/identity/identity.repository.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { PostgresClientInvitationRepository } from "../src/modules/client-invitations/client-invitation.repository.js";
import { ClientInvitationService } from "../src/modules/client-invitations/client-invitation.service.js";
import type { ClerkInvitationGateway, VerifiedClerkUser } from "../src/modules/client-invitations/client-invitation.types.js";

const PREFIX = "PHASE8A_SMOKE_";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
  throw new Error("PHASE8A_SMOKE_REQUIRES_LOCAL_POSTGRESQL");
}

class ControlledClerkGateway implements ClerkInvitationGateway {
  readonly existing = new Map<string, VerifiedClerkUser>();
  readonly verified = new Map<string, readonly string[]>();
  readonly activeInvitations = new Set<string>();
  private sequence = 0;

  findVerifiedUserByEmail(email: string) {
    return Promise.resolve(this.existing.get(email) ?? null);
  }
  getVerifiedEmails(clerkUserId: string) {
    return Promise.resolve(this.verified.get(clerkUserId) ?? []);
  }
  createInvitation() {
    const id = `inv_${PREFIX}${++this.sequence}`;
    this.activeInvitations.add(id);
    return Promise.resolve({ id });
  }
  revokeInvitation(clerkInvitationId: string) {
    this.activeInvitations.delete(clerkInvitationId);
    return Promise.resolve();
  }
}

const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8a-smoke" });
const organizationA = randomUUID();
const organizationB = randomUUID();
const actorUserId = randomUUID();
const newUserId = randomUUID();
const existingUserId = randomUUID();
const clerkNew = `${PREFIX}clerk_new`;
const clerkExisting = `${PREFIX}clerk_existing`;
const newEmail = `${PREFIX}new@example.test`.toLowerCase();
const existingEmail = `${PREFIX}existing@example.test`.toLowerCase();
const duplicateEmail = `${PREFIX}duplicate@example.test`.toLowerCase();
const expiredEmail = `${PREFIX}expired@example.test`.toLowerCase();
const revokedEmail = `${PREFIX}revoked@example.test`.toLowerCase();

const actor: ActorContext = {
  clerkUserId: `${PREFIX}clerk_actor`,
  localUserId: actorUserId,
  status: "active",
  internal: true,
  memberships: [{ organizationId: organizationA, roleId: randomUUID(), roleCode: "admin", status: "active" }],
  roles: [{ roleId: randomUUID(), code: "admin", scope: "global" }],
  permissions: [{
    code: "organization_members.manage",
    scopes: ["organization"],
    scopeOrganizationIds: { organization: [organizationA] },
  }],
};

const gateway = new ControlledClerkGateway();
const repository = new PostgresClientInvitationRepository(pool);
const service = new ClientInvitationService(
  repository,
  new AuthorizationService(),
  gateway,
  "http://127.0.0.1:5173",
);
const audit = (organizationId = organizationA) => ({
  actorUserId,
  organizationId,
  requestId: randomUUID(),
  ipAddress: "127.0.0.1",
  userAgent: "phase8a-smoke",
});

async function fixtureCount(): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT (
       (SELECT count(*) FROM organizations WHERE name LIKE $1) +
       (SELECT count(*) FROM app_users WHERE primary_email LIKE lower($1)) +
       (SELECT count(*) FROM organization_invitations WHERE normalized_email LIKE lower($1))
     )::text AS count`,
    [`${PREFIX}%`],
  );
  return Number(result.rows[0]!.count);
}

async function cleanup(): Promise<void> {
  await pool.query("DELETE FROM audit_events WHERE request_id IN (SELECT request_id FROM audit_events WHERE user_agent = 'phase8a-smoke')");
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [[organizationA, organizationB]]);
  await pool.query("DELETE FROM organization_invitations WHERE organization_id = ANY($1::uuid[])", [[organizationA, organizationB]]);
  await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationA, organizationB]]);
  await pool.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [[actorUserId, newUserId, existingUserId]]);
}

try {
  await cleanup();
  await pool.query(
    `INSERT INTO app_users (id, clerk_user_id, primary_email, status)
     VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'pending')`,
    [actorUserId, actor.clerkUserId, `${PREFIX}actor@example.test`.toLowerCase(), existingUserId, clerkExisting, existingEmail],
  );
  await pool.query(
    `INSERT INTO organizations (id, name, status) VALUES ($1, $2, 'active'), ($3, $4, 'active')`,
    [organizationA, `${PREFIX}ORG_A`, organizationB, `${PREFIX}ORG_B`],
  );

  const created = await service.create(actor, organizationA, {
    email: newEmail,
    membershipRole: "client_contact",
  }, audit());
  if (created.outcome !== "invitation_sent") throw new Error("NEW_INVITATION_NOT_SENT");
  await pool.query(
    `INSERT INTO app_users (id, clerk_user_id, primary_email, status)
     VALUES ($1, $2, $3, 'pending')`,
    [newUserId, clerkNew, newEmail],
  );
  gateway.verified.set(clerkNew, [newEmail]);
  const claimed = await service.claim(clerkNew, created.invitation.id, audit());
  const claimedAgain = await service.claim(clerkNew, created.invitation.id, audit());
  if (claimed.alreadyClaimed || !claimedAgain.alreadyClaimed) throw new Error("CLAIM_NOT_IDEMPOTENT");
  const profile = await new IdentityService(new PostgresIdentityRepository(pool)).getMe(clerkNew);
  if (!profile.organizations.some((organization) => organization.id === organizationA && organization.role === "client_contact")) {
    throw new Error("ME_MISSING_CLIENT_ORGANIZATION");
  }

  gateway.existing.set(existingEmail, { clerkUserId: clerkExisting, verifiedEmails: [existingEmail] });
  gateway.verified.set(clerkExisting, [existingEmail]);
  const existing = await service.create(actor, organizationA, {
    email: existingEmail,
    membershipRole: "client_manager",
  }, audit());
  if (existing.outcome !== "existing_account_granted") throw new Error("EXISTING_ACCOUNT_NOT_GRANTED");

  await service.create(actor, organizationA, {
    email: duplicateEmail,
    membershipRole: "client_contact",
  }, audit());
  let duplicateRejected = false;
  try {
    await service.create(actor, organizationA, {
      email: duplicateEmail,
      membershipRole: "client_contact",
    }, audit());
  } catch (error) {
    duplicateRejected = (error as { readonly statusCode?: number }).statusCode === 409;
  }
  if (!duplicateRejected) throw new Error("DUPLICATE_NOT_REJECTED");

  const expired = await service.create(actor, organizationA, {
    email: expiredEmail,
    membershipRole: "client_contact",
  }, audit());
  await pool.query(
    `UPDATE organization_invitations
     SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
     WHERE id = $1`,
    [expired.invitation.id],
  );
  const listed = await service.list(actor, organizationA);
  if (listed.find((item) => item.id === expired.invitation.id)?.status !== "expired") {
    throw new Error("EXPIRATION_NOT_APPLIED");
  }

  const revocable = await service.create(actor, organizationA, {
    email: revokedEmail,
    membershipRole: "client_contact",
  }, audit());
  const revoked = await service.revoke(actor, organizationA, revocable.invitation.id, audit());
  if (revoked.status !== "revoked") throw new Error("REVOCATION_NOT_APPLIED");

  let crossTenantRejected = false;
  try {
    await service.list(actor, organizationB);
  } catch (error) {
    crossTenantRejected = [403, 404].includes((error as { readonly statusCode?: number }).statusCode ?? 0);
  }
  if (!crossTenantRejected) throw new Error("CROSS_TENANT_NOT_REJECTED");

  const auditResult = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM audit_events
     WHERE organization_id = $1 AND user_agent = 'phase8a-smoke'`,
    [organizationA],
  );
  if (Number(auditResult.rows[0]!.count) < 5) throw new Error("AUDIT_EVENTS_MISSING");

  console.log(JSON.stringify({
    marker: PREFIX,
    newInvitation: true,
    claimIdempotent: true,
    meOrganization: true,
    existingAccount: true,
    duplicateRejected: true,
    expiration: true,
    revocation: true,
    crossTenant: true,
    audit: true,
  }));
} finally {
  await cleanup();
  const residualFixtures = await fixtureCount();
  console.log(JSON.stringify({ residualFixtures }));
  await pool.end();
}
