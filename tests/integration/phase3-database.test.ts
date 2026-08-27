import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import pg, { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationService } from "../../src/common/auth/authorization.service.js";
import { PrivilegedRoleService } from "../../src/common/auth/privileged-role.service.js";
import { TicketClientActionService } from "../../src/common/auth/ticket-client-action.service.js";
import { FileRepository } from "../../src/modules/files/file.repository.js";
import { PostgresIdentityRepository } from "../../src/modules/identity/identity.repository.js";
import { ClerkWebhookService } from "../../src/modules/webhooks/clerk-webhook.service.js";
import { clerkWebhookRoutes } from "../../src/modules/webhooks/clerk-webhook.routes.js";
import { OfficialClerkWebhookVerifier } from "../../src/modules/webhooks/clerk-webhook.verifier.js";
import { ORG_A, ORG_B, USER_A, USER_B, actor } from "../helpers/actors.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const USER_C = "00000000-0000-4000-8000-000000000003";
const FILE_A = "00000000-0000-4000-8000-000000000a01";
const FILE_B = "00000000-0000-4000-8000-000000000a02";
const TICKET_A = "00000000-0000-4000-8000-000000000701";
const TICKET_A_REJECT = "00000000-0000-4000-8000-000000000702";
const TICKET_A_CLOSED = "00000000-0000-4000-8000-000000000703";
const TICKET_B = "00000000-0000-4000-8000-000000000704";

describe.skipIf(testDatabaseUrl === undefined)("Phase 3 PostgreSQL behavior", () => {
  const schema = `ilvox_phase3_test_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  let admin: pg.Client;
  let pool: Pool;
  let webhook: ClerkWebhookService;
  let files: FileRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quote(schema)}`);
    await admin.query(`SET search_path TO ${quote(schema)}, public`);
    await admin.query(readFileSync(resolve("drizzle", "baseline", "0000_ilvox_complete_reconstructed.sql"), "utf8"));
    for (const name of [
      "0001_phase3-rbac-separation.sql",
      "0002_phase3-file-audience.sql",
      "0003_phase3-clerk-event-idempotency.sql",
      "0006_phase5-member-revocation.sql",
    ]) {
      await admin.query(readFileSync(resolve("drizzle", "migrations", name), "utf8")
        .replaceAll("--> statement-breakpoint", ""));
    }
    pool = new Pool({ connectionString: testDatabaseUrl, max: 2, options: `-c search_path=${schema},public` });
    webhook = new ClerkWebhookService(pool);
    files = new FileRepository(pool);
    const currentSchema = await pool.query<{ readonly current_schema: string }>("SELECT current_schema()");
    expect(currentSchema.rows[0]?.current_schema).toBe(schema);

    await pool.query(
      `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
       ($1,'clerk_a','a@example.test','active'),
       ($2,'clerk_b','b@example.test','active'),
       ($3,'clerk_c','c@example.test','active')`, [USER_A, USER_B, USER_C],
    );
    await pool.query(
      `INSERT INTO organizations (id,name,status) VALUES
       ($1,'Organization A','active'),($2,'Organization B','active')`, [ORG_A, ORG_B],
    );
    await pool.query(
      `INSERT INTO organization_memberships
         (organization_id,user_id,role_id,role_scope,status,activated_at,revoked_at)
       SELECT $1::uuid,$2::uuid,r.id,'organization','active',now(),NULL::timestamptz FROM roles r
        WHERE r.scope='organization' AND r.code='client_manager'
       UNION ALL
       SELECT $3::uuid,$2::uuid,r.id,'organization','active',now(),NULL::timestamptz FROM roles r
        WHERE r.scope='organization' AND r.code='client_contact'
       UNION ALL
       SELECT $1::uuid,$4::uuid,r.id,'organization','revoked',NULL::timestamptz,now() FROM roles r
        WHERE r.scope='organization' AND r.code='client_contact'`,
      [ORG_A, USER_C, ORG_B, USER_B],
    );
    await pool.query(
      `INSERT INTO files
       (id,organization_id,uploaded_by_user_id,original_name,storage_provider,object_key,
        mime_type,size_bytes,classification,audience,status)
       VALUES
       ($1,$2,$3,'a-report.pdf','memory','org-a/a-report.pdf','application/pdf',100,'confidential','organization','active'),
       ($4,$5,$6,'b-secret.pdf','memory','org-b/b-secret.pdf','application/pdf',100,'confidential','internal','active')`,
      [FILE_A, ORG_A, USER_A, FILE_B, ORG_B, USER_B],
    );
    await pool.query(
      `INSERT INTO tickets
       (id,organization_id,requester_user_id,type,status,subject,description,resolution,resolved_at,closed_at)
       VALUES
       ($1,$2,$3,'incident','resolved','A resolved','Test','Done',now(),NULL),
       ($4,$2,$3,'incident','resolved','A reject','Test','Done',now(),NULL),
       ($5,$2,$3,'incident','closed','A closed','Test','Done',now(),now()),
       ($6,$7,$8,'incident','resolved','B resolved','Test','Done',now(),NULL)`,
      [TICKET_A, ORG_A, USER_A, TICKET_A_REJECT, TICKET_A_CLOSED, TICKET_B, ORG_B, USER_B],
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

  it("processes create/update/delete idempotently and rejects out-of-order overwrites", async () => {
    const createdAt = new Date("2026-07-22T12:00:00.000Z");
    const created = {
      type: "user.created" as const, occurredAt: createdAt, clerkUserId: "clerk_webhook_user",
      primaryEmail: "new@example.test", firstName: "New", lastName: "User", avatarUrl: null,
    };
    expect((await webhook.process("evt_create", Buffer.from("create"), created)).status).toBe("processed");
    expect((await webhook.process("evt_create", Buffer.from("create"), created)).status).toBe("duplicate");

    const newer = { ...created, type: "user.updated" as const,
      occurredAt: new Date("2026-07-22T13:00:00.000Z"), primaryEmail: "newer@example.test" };
    expect((await webhook.process("evt_newer", Buffer.from("newer"), newer)).status).toBe("processed");
    const older = { ...created, type: "user.updated" as const,
      occurredAt: new Date("2026-07-22T12:30:00.000Z"), primaryEmail: "older@example.test" };
    expect((await webhook.process("evt_older", Buffer.from("older"), older)).status).toBe("obsolete");
    const user = await pool.query<{ readonly primary_email: string }>(
      "SELECT primary_email FROM app_users WHERE clerk_user_id='clerk_webhook_user'",
    );
    expect(user.rows[0]?.primary_email).toBe("newer@example.test");

    const deleted = { type: "user.deleted" as const, occurredAt: new Date("2026-07-22T14:00:00.000Z"),
      clerkUserId: "clerk_webhook_user" };
    await webhook.process("evt_deleted", Buffer.from("deleted"), deleted);
    const status = await pool.query<{ readonly status: string }>(
      "SELECT status FROM app_users WHERE clerk_user_id='clerk_webhook_user'",
    );
    expect(status.rows[0]?.status).toBe("deleted");

    const tombstoneDelete = { type: "user.deleted" as const,
      occurredAt: new Date("2026-07-22T16:00:00.000Z"), clerkUserId: "clerk_delete_first" };
    await webhook.process("evt_delete_first", Buffer.from("delete-first"), tombstoneDelete);
    const staleCreate = { ...created, occurredAt: new Date("2026-07-22T15:30:00.000Z"),
      clerkUserId: "clerk_delete_first", primaryEmail: "must-not-resurrect@example.test" };
    expect((await webhook.process("evt_stale_create", Buffer.from("stale-create"), staleCreate)).status)
      .toBe("obsolete");
    const tombstone = await pool.query<{ readonly status: string; readonly primary_email: string }>(
      "SELECT status,primary_email FROM app_users WHERE clerk_user_id='clerk_delete_first'",
    );
    expect(tombstone.rows[0]?.status).toBe("deleted");
    expect(tombstone.rows[0]?.primary_email).not.toBe("must-not-resurrect@example.test");
  });

  it("persists a signed user.created through the HTTP route and replays it idempotently", async () => {
    const signingKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const signingSecret = `whsec_${signingKey.toString("base64")}`;
    const eventId = `msg_phase3_db_${randomBytes(5).toString("hex")}`;
    const clerkUserId = `clerk_http_${randomBytes(5).toString("hex")}`;
    const raw = JSON.stringify({
      object: "event",
      type: "user.created",
      timestamp: Date.now(),
      data: {
        id: clerkUserId,
        primary_email_address_id: "email_primary",
        email_addresses: [{ id: "email_primary", email_address: "http-webhook@example.test" }],
        first_name: "HTTP",
        last_name: "Webhook",
        image_url: null,
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac("sha256", signingKey)
      .update(`${eventId}.${timestamp}.${raw}`)
      .digest("base64");
    const app = Fastify({ logger: false });
    await app.register(clerkWebhookRoutes, {
      verifier: new OfficialClerkWebhookVerifier(signingSecret),
      service: webhook,
    });

    try {
      const request = () => app.inject({
        method: "POST",
        url: "/webhooks/clerk",
        headers: {
          "content-type": "application/json",
          "svix-id": eventId,
          "svix-timestamp": timestamp,
          "svix-signature": `v1,${signature}`,
        },
        payload: raw,
      });
      const first = await request();
      const replay = await request();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toEqual({ data: { status: "processed", eventId } });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toEqual({ data: { status: "duplicate", eventId } });

      const users = await pool.query<{ readonly count: string }>(
        "SELECT count(*)::text AS count FROM app_users WHERE clerk_user_id=$1",
        [clerkUserId],
      );
      const events = await pool.query<{ readonly status: string; readonly attempt_count: number }>(
        `SELECT status,attempt_count FROM identity_webhook_events
         WHERE clerk_event_id=$1`,
        [eventId],
      );
      expect(users.rows[0]?.count).toBe("1");
      expect(events.rows).toEqual([{ status: "processed", attempt_count: 1 }]);
    } finally {
      await app.close();
    }
  });

  it("serializes concurrent duplicate webhook deliveries", async () => {
    const event = { type: "user.created" as const, occurredAt: new Date("2026-07-22T17:00:00.000Z"),
      clerkUserId: "clerk_concurrent", primaryEmail: "concurrent@example.test",
      firstName: null, lastName: null, avatarUrl: null };
    const results = await Promise.all([
      webhook.process("evt_concurrent", Buffer.from("concurrent"), event),
      webhook.process("evt_concurrent", Buffer.from("concurrent"), event),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["duplicate", "processed"]);
    expect((await pool.query("SELECT 1 FROM app_users WHERE clerk_user_id='clerk_concurrent'")).rowCount).toBe(1);
  });

  it("loads only active memberships and preserves per-organization permission grants", async () => {
    const repository = new PostgresIdentityRepository(pool);
    const profile = await repository.findByClerkUserId("clerk_c");
    expect(profile?.actor.memberships.map((membership) => membership.organizationId).sort())
      .toEqual([ORG_A, ORG_B].sort());
    const manageMembers = profile?.actor.permissions.find((permission) =>
      permission.code === "organization_members.manage");
    expect(manageMembers?.scopeOrganizationIds?.organization).toEqual([ORG_A]);

    const revokedOnly = await repository.findByClerkUserId("clerk_b");
    expect(revokedOnly?.actor.memberships).toEqual([]);
  });

  it("records a safe failure, rolls back the user and permits a later retry", async () => {
    const event = { type: "user.created" as const, occurredAt: new Date("2026-07-22T15:00:00.000Z"),
      clerkUserId: "clerk_retry_user" };
    const raw = Buffer.from("retry-same-payload");
    await expect(webhook.process("evt_retry", raw, event)).rejects.toBeDefined();
    const failed = await pool.query<{ readonly status: string; readonly last_error_code: string }>(
      "SELECT status,last_error_code FROM identity_webhook_events WHERE clerk_event_id='evt_retry'",
    );
    expect(failed.rows[0]).toMatchObject({ status: "failed", last_error_code: "PROCESSING_FAILED" });
    expect((await pool.query("SELECT 1 FROM app_users WHERE clerk_user_id='clerk_retry_user'")).rowCount).toBe(0);

    const retry = { ...event, primaryEmail: "retry@example.test", firstName: null, lastName: null, avatarUrl: null };
    expect((await webhook.process("evt_retry", raw, retry)).status).toBe("processed");
    expect((await pool.query("SELECT 1 FROM app_users WHERE clerk_user_id='clerk_retry_user'")).rowCount).toBe(1);
  });

  it("applies organization, assigned, own, global and public scopes to lists and counts", async () => {
    const organization = { kind: "organization" as const, actorId: USER_A, organizationIds: [ORG_A] };
    expect(await files.countAuthorized(organization, ["organization", "internal"])).toBe(1);
    expect((await files.listAuthorized(organization, ["organization"], 10, 0)).map((file) => file.id)).toEqual([FILE_A]);
    expect((await files.searchAuthorized(organization, ["organization"], "report")).length).toBe(1);
    expect(await files.aggregateByAudience(organization, ["organization", "internal"]))
      .toEqual({ internal: 0, organization: 1 });

    const assigned = { kind: "assigned" as const, actorId: USER_A, organizationIds: [ORG_A] };
    const own = { kind: "own" as const, actorId: USER_A, organizationIds: [ORG_A] };
    expect(await files.countAuthorized(assigned, ["organization"])).toBe(1);
    expect(await files.countAuthorized(own, ["organization"])).toBe(1);
    expect(await files.countAuthorized({ kind: "global", actorId: USER_A, crossOrganization: true },
      ["organization", "internal"])).toBe(2);
    expect(await files.countAuthorized({ kind: "public" }, ["organization", "internal"])).toBe(0);
    expect((await files.listAuthorized(organization, ["organization"], 1, 1)).length).toBe(0);
  });

  it("assigns super_admin idempotently and protects the last active super_admin", async () => {
    const superRole = await pool.query<{ readonly id: string }>(
      "SELECT id FROM roles WHERE scope='global' AND code='super_admin'",
    );
    await pool.query("INSERT INTO user_roles (user_id,role_id,role_scope) VALUES ($1,$2,'global')",
      [USER_A, superRole.rows[0]?.id]);
    const service = new PrivilegedRoleService(pool, new AuthorizationService());
    const actorA = actor({ internal: true, roleCode: "super_admin", organizations: [], localUserId: USER_A,
      permissions: [{ code: "roles.assign_super_admin", scopes: ["global"] }] });
    expect(await service.assignSuperAdmin(actorA, USER_C, "00000000-0000-4000-8000-000000000901")).toBe("assigned");
    expect(await service.assignSuperAdmin(actorA, USER_C, "00000000-0000-4000-8000-000000000901")).toBe("duplicate");

    const actorC = actor({ internal: true, roleCode: "super_admin", organizations: [], localUserId: USER_C,
      permissions: [{ code: "roles.assign_super_admin", scopes: ["global"] }] });
    expect(await service.revokeSuperAdmin(actorC, USER_A, "00000000-0000-4000-8000-000000000902")).toBe("revoked");
    await expect(service.revokeSuperAdmin(actorA, USER_C, "00000000-0000-4000-8000-000000000903"))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces client ticket intentions, organization isolation and idempotency", async () => {
    const authorization = new AuthorizationService();
    const service = new TicketClientActionService(pool, authorization);
    const client = actor({ localUserId: USER_A, permissions: [
      { code: "tickets.confirm_resolution", scopes: ["organization"] },
      { code: "tickets.reject_resolution", scopes: ["organization"] },
      { code: "tickets.request_reopen", scopes: ["organization"] },
    ] });
    expect(authorization.can({ actor: client, action: "tickets.change_status", organizationId: ORG_A }).allowed)
      .toBe(false);
    expect(authorization.can({ actor: client, action: "tickets.close", organizationId: ORG_A }).allowed)
      .toBe(false);

    const confirm = { actor: client, action: "tickets.confirm_resolution" as const,
      ticketId: TICKET_A, organizationId: ORG_A,
      requestId: "00000000-0000-4000-8000-000000000911" };
    expect(await service.execute(confirm)).toBe("applied");
    expect(await service.execute(confirm)).toBe("duplicate");

    await expect(service.execute({ ...confirm, ticketId: TICKET_B,
      requestId: "00000000-0000-4000-8000-000000000912" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.execute({ actor: client, action: "tickets.reject_resolution",
      ticketId: TICKET_A_REJECT, organizationId: ORG_A,
      requestId: "00000000-0000-4000-8000-000000000913" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.execute({ actor: client, action: "tickets.reject_resolution",
      ticketId: TICKET_A_REJECT, organizationId: ORG_A, reason: "Needs work", requestedTargetState: "closed",
      requestId: "00000000-0000-4000-8000-000000000914" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await service.execute({ actor: client, action: "tickets.reject_resolution",
      ticketId: TICKET_A_REJECT, organizationId: ORG_A, reason: "Needs work",
      requestId: "00000000-0000-4000-8000-000000000915" })).toBe("applied");
    expect(await service.execute({ actor: client, action: "tickets.request_reopen",
      ticketId: TICKET_A_CLOSED, organizationId: ORG_A, reason: "Issue returned",
      requestId: "00000000-0000-4000-8000-000000000916" })).toBe("applied");
  });
});
