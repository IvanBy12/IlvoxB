import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import type { ActorContext } from "../../src/common/auth/authorization.types.js";
import { ClientInvitationService } from "../../src/modules/client-invitations/client-invitation.service.js";
import { PostgresClientInvitationRepository } from "../../src/modules/client-invitations/client-invitation.repository.js";
import type {
  ClerkInvitationGateway,
  VerifiedClerkUser,
} from "../../src/modules/client-invitations/client-invitation.types.js";
import { PostgresIdentityRepository } from "../../src/modules/identity/identity.repository.js";
import { IdentityService } from "../../src/modules/identity/identity.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ACTOR_ID = "80000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "80000000-0000-4000-8000-000000000002";
const MISSING_ORGANIZATION_ID = "80000000-0000-4000-8000-000000000003";
const now = new Date("2026-08-27T16:00:00.000Z");

function profile(clerkUserId: string, email: string): VerifiedClerkUser {
  return {
    clerkUserId,
    verifiedEmails: [email],
    primaryEmail: email,
    firstName: "Invited",
    lastName: "Client",
    avatarUrl: null,
    syncedAt: now,
  };
}

class ControlledClerkGateway implements ClerkInvitationGateway {
  readonly byEmail = new Map<string, VerifiedClerkUser>();
  readonly byId = new Map<string, VerifiedClerkUser>();
  readonly created: { readonly id: string; readonly email: string }[] = [];

  findVerifiedUserByEmail(normalizedEmail: string) {
    return Promise.resolve(this.byEmail.get(normalizedEmail) ?? null);
  }

  getVerifiedUser(clerkUserId: string) {
    const identity = this.byId.get(clerkUserId);
    if (identity === undefined) throw new Error("TEST_CLERK_PROFILE_NOT_FOUND");
    return Promise.resolve(identity);
  }

  getVerifiedEmails(clerkUserId: string) {
    return Promise.resolve(this.byId.get(clerkUserId)?.verifiedEmails ?? []);
  }

  createInvitation(input: { readonly email: string }) {
    const invitation = { id: `inv_phase8a_${this.created.length + 1}`, email: input.email };
    this.created.push(invitation);
    return Promise.resolve({ id: invitation.id });
  }

  revokeInvitation() {
    return Promise.resolve();
  }

  add(identity: VerifiedClerkUser, discoverableByEmail = false): void {
    this.byId.set(identity.clerkUserId, identity);
    if (discoverableByEmail) {
      for (const email of identity.verifiedEmails) this.byEmail.set(email, identity);
    }
  }
}

describe.skipIf(testDatabaseUrl === undefined)("Phase 8A PostgreSQL onboarding", () => {
  const schema = `ilvox_phase8a_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const gateway = new ControlledClerkGateway();
  const actor: ActorContext = {
    clerkUserId: "phase8a_actor",
    localUserId: ACTOR_ID,
    status: "active",
    internal: true,
    memberships: [],
    roles: [],
    permissions: [{
      code: "organization_members.manage",
      scopes: ["organization"],
      scopeOrganizationIds: { organization: [ORGANIZATION_ID, MISSING_ORGANIZATION_ID] },
    }],
  };
  const audit = () => ({ actorUserId: ACTOR_ID, organizationId: ORGANIZATION_ID, requestId: randomUUID() });
  let admin: pg.Client;
  let pool: Pool;
  let service: ClientInvitationService;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quote(schema)}`);
    await admin.query(`SET search_path TO ${quote(schema)}, public`);
    await admin.query(readFileSync(
      resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"),
      "utf8",
    ));
    for (const migration of [
      "0001_phase3-rbac-separation.sql",
      "0002_phase3-file-audience.sql",
      "0003_phase3-clerk-event-idempotency.sql",
      "0006_phase5-member-revocation.sql",
      "0009_phase8a-client-invitations.sql",
    ]) {
      const sql = readFileSync(resolve("drizzle", "migrations", migration), "utf8")
        .replaceAll("--> statement-breakpoint", "")
        .replaceAll('"public".', `${quote(schema)}.`);
      await admin.query(sql);
    }
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 4,
      options: `-c search_path=${schema},public`,
    });
    await pool.query(
      `INSERT INTO app_users (id,clerk_user_id,primary_email,status)
       VALUES ($1,$2,$3,'active')`,
      [ACTOR_ID, actor.clerkUserId, "phase8a-actor@example.test"],
    );
    await pool.query(
      "INSERT INTO organizations (id,name,status) VALUES ($1,'Phase 8A Organization','active')",
      [ORGANIZATION_ID],
    );
    service = new ClientInvitationService(
      new PostgresClientInvitationRepository(pool),
      new AuthorizationService(),
      gateway,
      "http://127.0.0.1:5173",
      () => now,
    );
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query("RESET search_path").catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      await admin.end();
    }
  });

  it("reconciles a missing local profile during claim and creates one membership idempotently", async () => {
    const email = "phase8a-race@example.test";
    const clerkUserId = "phase8a_clerk_race";
    const created = await service.create(actor, ORGANIZATION_ID, {
      email,
      membershipRole: "client_contact",
    }, audit());
    expect(created.outcome).toBe("invitation_sent");
    expect(created.invitation.id).not.toBe(created.invitation.clerkInvitationId);
    expect(created.invitation.clerkInvitationId).toBe(gateway.created.at(-1)?.id);
    expect((await pool.query("SELECT 1 FROM app_users WHERE clerk_user_id=$1", [clerkUserId])).rowCount).toBe(0);

    gateway.add(profile(clerkUserId, email));
    const claimed = await service.claim(clerkUserId, created.invitation.id, audit());
    expect(claimed).toMatchObject({
      alreadyClaimed: false,
      profileExisted: false,
      reconciliationAttempted: true,
      membershipCreated: true,
    });

    const state = await pool.query<{
      readonly user_id: string;
      readonly user_status: string;
      readonly invitation_status: string;
      readonly membership_status: string;
      readonly role_code: string;
    }>(
      `SELECT u.id AS user_id,u.status AS user_status,i.status AS invitation_status,
              m.status AS membership_status,r.code AS role_code
       FROM app_users u
       JOIN organization_invitations i ON i.accepted_by_user_id=u.id
       JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=i.organization_id
       JOIN roles r ON r.id=m.role_id AND r.scope=m.role_scope
       WHERE u.clerk_user_id=$1 AND i.id=$2`,
      [clerkUserId, created.invitation.id],
    );
    expect(state.rows).toEqual([expect.objectContaining({
      user_status: "active",
      invitation_status: "accepted",
      membership_status: "active",
      role_code: "client_contact",
    })]);
    const me = await new IdentityService(new PostgresIdentityRepository(pool)).getMe(clerkUserId);
    expect(me.organizations).toContainEqual(expect.objectContaining({ id: ORGANIZATION_ID, role: "client_contact" }));

    const replay = await service.claim(clerkUserId, created.invitation.id, audit());
    expect(replay.alreadyClaimed).toBe(true);
    expect((await pool.query<{ readonly count: number }>("SELECT count(*)::int AS count FROM app_users WHERE clerk_user_id=$1", [clerkUserId])).rows[0]?.count).toBe(1);
    expect((await pool.query<{ readonly count: number }>("SELECT count(*)::int AS count FROM organization_memberships WHERE user_id=$1", [state.rows[0]!.user_id])).rows[0]?.count).toBe(1);
  });

  it("does not provision a Clerk identity without a valid local invitation", async () => {
    const identity = profile("phase8a_clerk_without_invitation", "phase8a-no-invitation@example.test");
    gateway.add(identity);
    await expect(service.claim(identity.clerkUserId, randomUUID(), audit())).rejects.toMatchObject({
      code: "INVITATION_NOT_FOUND",
      statusCode: 404,
    });
    expect((await pool.query("SELECT 1 FROM app_users WHERE clerk_user_id=$1", [identity.clerkUserId])).rowCount).toBe(0);
  });

  it("creates and grants an existing Clerk identity even when its webhook profile is absent", async () => {
    const email = "phase8a-existing@example.test";
    const identity = profile("phase8a_clerk_existing", email);
    gateway.add(identity, true);
    const result = await service.create(actor, ORGANIZATION_ID, {
      email,
      membershipRole: "client_manager",
    }, audit());
    expect(result).toMatchObject({ outcome: "existing_account_granted", invitation: { status: "accepted" } });
    expect(result.invitation.clerkInvitationId).toBeNull();
    const persisted = await pool.query(
      `SELECT 1 FROM app_users u
       JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=$2
       JOIN roles r ON r.id=m.role_id AND r.code='client_manager'
       WHERE u.clerk_user_id=$1 AND u.status='active' AND m.status='active'`,
      [identity.clerkUserId, ORGANIZATION_ID],
    );
    expect(persisted.rowCount).toBe(1);
  });

  it("distinguishes a missing organization and rejects duplicate pending invitations explicitly", async () => {
    await expect(service.create(actor, MISSING_ORGANIZATION_ID, {
      email: "phase8a-missing-org@example.test",
      membershipRole: "client_contact",
    }, audit())).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND", statusCode: 404 });

    const email = "phase8a-duplicate@example.test";
    await service.create(actor, ORGANIZATION_ID, { email, membershipRole: "client_contact" }, audit());
    await expect(service.create(actor, ORGANIZATION_ID, {
      email,
      membershipRole: "client_contact",
    }, audit())).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A pending invitation already exists for this email and organization",
    });
    expect((await pool.query<{ readonly count: number }>(
      "SELECT count(*)::int AS count FROM organization_invitations WHERE organization_id=$1 AND normalized_email=$2",
      [ORGANIZATION_ID, email],
    )).rows[0]?.count).toBe(1);
  });
});
