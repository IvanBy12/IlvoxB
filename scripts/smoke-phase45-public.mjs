import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";
import { buildApp } from "../dist/app.js";
import { PostgresLeadRepository } from "../dist/modules/leads/lead.repository.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  throw new Error("DATABASE_URL_MISSING");
}

const tag = `phase45_smoke_${Date.now()}_${randomBytes(3).toString("hex")}`;
const ids = {
  admin: randomUUID(),
  contributor: randomUUID(),
  client: randomUUID(),
  seedService: randomUUID(),
  reuseOrganization: randomUUID(),
  standalone: randomUUID(),
  standaloneConcurrent: randomUUID(),
  createOrganization: randomUUID(),
  sameNameOrganization: randomUUID(),
  reuse: randomUUID(),
  rollback: randomUUID(),
};
const clerkIds = {
  admin: `${tag}_admin`,
  contributor: `${tag}_contributor`,
  client: `${tag}_client`,
};
const pool = new pg.Pool({ connectionString, max: 10 });
const actorByHeader = {
  admin: clerkIds.admin,
  contributor: clerkIds.contributor,
  client: clerkIds.client,
};
const authenticationProvider = {
  authenticate(request) {
    const requested = request.headers["x-smoke-actor"];
    const clerkUserId = typeof requested === "string" ? actorByHeader[requested] : undefined;
    return Promise.resolve(clerkUserId === undefined ? null : { clerkUserId });
  },
};

let app;
let failure;
const results = {
  tag,
  standalone: {},
  organizational: {},
  services: {},
  safety: { clerkUsersCreated: 0, clerkSessionsCreated: 0, contactsCreated: 0 },
  cleanup: {},
};

async function request(actor, options, expectedStatus) {
  const response = await app.inject({
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(actor === undefined ? {} : { "x-smoke-actor": actor }),
    },
  });
  assert.equal(
    response.statusCode,
    expectedStatus,
    `${options.method} ${options.url}: expected ${expectedStatus}, got ${response.statusCode} ${response.body}`,
  );
  return response;
}

async function counts() {
  const query = await pool.query(`SELECT
    (SELECT count(*)::int FROM organizations) AS organizations,
    (SELECT count(*)::int FROM organization_memberships) AS memberships,
    (SELECT count(*)::int FROM app_users) AS users`);
  return query.rows[0];
}

async function setup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO app_users (id,clerk_user_id,primary_email,status)
       VALUES ($1,$2,$3,'active'),($4,$5,$6,'active'),($7,$8,$9,'active')`,
      [
        ids.admin, clerkIds.admin, `${tag}_admin@example.test`,
        ids.contributor, clerkIds.contributor, `${tag}_contributor@example.test`,
        ids.client, clerkIds.client, `${tag}_client@example.test`,
      ],
    );
    await client.query(
      `INSERT INTO user_roles (user_id,role_id,role_scope)
       SELECT $1::uuid,id,'global' FROM roles WHERE scope='global' AND code='super_admin'
       UNION ALL
       SELECT $2::uuid,id,'global' FROM roles WHERE scope='global' AND code='contributor'`,
      [ids.admin, ids.contributor],
    );
    await client.query(
      `INSERT INTO services (id,name,category,description,is_public,is_active)
       VALUES ($1,$2,'development','Phase 4.5 smoke dependency',true,true)`,
      [ids.seedService, `${tag}_seed_service`],
    );
    await client.query(
      `INSERT INTO organizations (id,name,status)
       VALUES ($1,$2,'active')`,
      [ids.reuseOrganization, `${tag}_reuse_organization`],
    );
    await client.query(
      `INSERT INTO organization_memberships
         (organization_id,user_id,role_id,role_scope,status,activated_at)
       SELECT $1,$2,id,'organization','active',now()
       FROM roles WHERE scope='organization' AND code='client_manager'`,
      [ids.reuseOrganization, ids.client],
    );
    const leadRows = [
      [ids.standalone, "standalone"],
      [ids.standaloneConcurrent, "standalone_concurrent"],
      [ids.createOrganization, "create_organization"],
      [ids.sameNameOrganization, "same_name_organization"],
      [ids.reuse, "reuse_organization"],
      [ids.rollback, "rollback"],
    ];
    for (const [leadId, suffix] of leadRows) {
      await client.query(
        `INSERT INTO leads
           (id,full_name,email,service_id,message,source,status,assigned_to_user_id)
         VALUES ($1,$2,$3,$4,'Phase 4.5 public smoke','contact','approved',$5)`,
        [leadId, `${tag}_${suffix}`, `${tag}_${suffix}@example.test`, ids.seedService, ids.admin],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function smokeStandalone() {
  const before = await counts();
  const first = await request("admin", {
    method: "POST",
    url: `/api/v1/leads/${ids.standalone}/convert`,
    payload: { mode: "standalone" },
  }, 200);
  const firstData = first.json().data;
  assert.deepEqual(
    {
      mode: firstData.mode,
      organizationCreated: firstData.organizationCreated,
      organizationId: firstData.organizationId,
      status: firstData.status,
      idempotent: firstData.idempotent,
      primaryContactCreated: firstData.primaryContactCreated,
    },
    {
      mode: "standalone",
      organizationCreated: false,
      organizationId: null,
      status: "converted",
      idempotent: false,
      primaryContactCreated: false,
    },
  );
  const retry = await request("admin", {
    method: "POST",
    url: `/api/v1/leads/${ids.standalone}/convert`,
    payload: { mode: "standalone" },
  }, 200);
  assert.equal(retry.json().data.idempotent, true);
  await request("admin", {
    method: "POST",
    url: `/api/v1/leads/${ids.standalone}/convert`,
    payload: { mode: "create_organization", name: `${tag}_incompatible` },
  }, 409);

  const concurrentResponses = await Promise.all([
    request("admin", {
      method: "POST",
      url: `/api/v1/leads/${ids.standaloneConcurrent}/convert`,
      payload: { mode: "standalone" },
    }, 200),
    request("admin", {
      method: "POST",
      url: `/api/v1/leads/${ids.standaloneConcurrent}/convert`,
      payload: { mode: "standalone" },
    }, 200),
  ]);
  assert.deepEqual(
    concurrentResponses.map((response) => response.json().data.idempotent).sort(),
    [false, true],
  );
  const after = await counts();
  assert.deepEqual(after, before);
  const persisted = await pool.query(
    `SELECT status,converted_at IS NOT NULL AS has_converted_at,converted_organization_id
     FROM leads WHERE id=$1`,
    [ids.standalone],
  );
  assert.deepEqual(persisted.rows[0], {
    status: "converted",
    has_converted_at: true,
    converted_organization_id: null,
  });
  const audit = await pool.query(
    `SELECT count(*)::int AS total,
            bool_and(new_values ->> 'mode' = 'standalone') AS safe_mode,
            bool_and(NOT (new_values ? 'email') AND NOT (new_values ? 'fullName')) AS redacted
     FROM audit_events WHERE entity_type='lead' AND entity_id IN ($1,$2)
       AND action='lead.converted'`,
    [ids.standalone, ids.standaloneConcurrent],
  );
  assert.deepEqual(audit.rows[0], { total: 2, safe_mode: true, redacted: true });
  results.standalone = {
    firstStatus: first.statusCode,
    retryStatus: retry.statusCode,
    retryIdempotent: true,
    incompatibleModeStatus: 409,
    concurrentStatuses: concurrentResponses.map((response) => response.statusCode),
    concurrentIdempotency: [false, true],
    organizationDelta: 0,
    membershipDelta: 0,
    localUserDelta: 0,
    auditEvents: 2,
  };
}

async function smokeOrganizationalConversions() {
  const name = `${tag}_same_name`;
  const body = { mode: "create_organization", name };
  const concurrent = await Promise.all([
    request("admin", {
      method: "POST",
      url: `/api/v1/leads/${ids.createOrganization}/convert`,
      payload: body,
    }, 200),
    request("admin", {
      method: "POST",
      url: `/api/v1/leads/${ids.createOrganization}/convert`,
      payload: body,
    }, 200),
  ]);
  const concurrentData = concurrent.map((response) => response.json().data);
  assert.equal(new Set(concurrentData.map((data) => data.organizationId)).size, 1);
  assert.deepEqual(concurrentData.map((data) => data.idempotent).sort(), [false, true]);

  const sameName = await request("admin", {
    method: "POST",
    url: `/api/v1/leads/${ids.sameNameOrganization}/convert`,
    payload: body,
  }, 200);
  assert.notEqual(sameName.json().data.organizationId, concurrentData[0].organizationId);
  const nameCount = await pool.query(
    "SELECT count(*)::int AS total FROM organizations WHERE name=$1",
    [name],
  );
  assert.equal(nameCount.rows[0].total, 2);

  const reuseBody = {
    mode: "reuse_organization",
    organizationId: ids.reuseOrganization,
  };
  const reuseFirst = await request("admin", {
    method: "POST",
    url: `/api/v1/leads/${ids.reuse}/convert`,
    payload: reuseBody,
  }, 200);
  const reuseRetry = await request("admin", {
    method: "POST",
    url: `/api/v1/leads/${ids.reuse}/convert`,
    payload: reuseBody,
  }, 200);
  assert.equal(reuseFirst.json().data.organizationId, ids.reuseOrganization);
  assert.equal(reuseFirst.json().data.idempotent, false);
  assert.equal(reuseRetry.json().data.idempotent, true);

  await request("client", {
    method: "POST",
    url: `/api/v1/leads/${ids.rollback}/convert`,
    payload: { mode: "standalone" },
  }, 403);
  const repository = new PostgresLeadRepository(pool);
  const globalScope = { kind: "global", actorId: ids.admin, crossOrganization: true };
  await assert.rejects(
    repository.convert(
      globalScope,
      globalScope,
      ids.rollback,
      { mode: "create_organization", name: `${tag}_must_rollback` },
      { actorUserId: ids.admin, requestId: "not-a-uuid" },
    ),
    (error) => error?.code === "22P02",
  );
  const rollbackState = await pool.query(
    `SELECT status,converted_at,converted_organization_id,
            (SELECT count(*)::int FROM organizations WHERE name=$2) AS organizations
     FROM leads WHERE id=$1`,
    [ids.rollback, `${tag}_must_rollback`],
  );
  assert.deepEqual(rollbackState.rows[0], {
    status: "approved",
    converted_at: null,
    converted_organization_id: null,
    organizations: 0,
  });
  results.organizational = {
    createStatus: 200,
    createRetryIdempotent: true,
    createConcurrentIdempotency: [false, true],
    sameNameOrganizations: 2,
    automaticNameMerge: false,
    reuseStatus: reuseFirst.statusCode,
    reuseRetryIdempotent: true,
    unauthorizedScopeStatus: 403,
    transactionalRollback: true,
    primaryContactsCreated: 0,
  };
}

async function smokeServices() {
  const serviceName = `${tag}_managed_service`;
  const createPayload = {
    name: serviceName,
    category: "automation",
    description: "Phase 4.5 managed service smoke",
    isPublic: true,
    isActive: true,
  };
  const created = await request("admin", {
    method: "POST",
    url: "/api/v1/admin/services",
    payload: createPayload,
  }, 201);
  const serviceId = created.json().data.id;
  const search = encodeURIComponent(serviceName);
  const adminList = await request("admin", {
    method: "GET",
    url: `/api/v1/admin/services?search=${search}`,
  }, 200);
  assert.equal(adminList.json().data.items.some((item) => item.id === serviceId), true);
  const publicList = await request(undefined, {
    method: "GET",
    url: `/api/v1/services?search=${search}`,
  }, 200);
  assert.equal(publicList.json().data.items.some((item) => item.id === serviceId), true);
  assert.equal((await request("admin", {
    method: "GET",
    url: `/api/v1/admin/services/${serviceId}`,
  }, 200)).json().data.id, serviceId);
  assert.equal((await request(undefined, {
    method: "GET",
    url: `/api/v1/services/${serviceId}`,
  }, 200)).json().data.id, serviceId);

  await request("admin", {
    method: "PATCH",
    url: `/api/v1/admin/services/${serviceId}`,
    payload: { isPublic: false },
  }, 200);
  await request(undefined, {
    method: "GET",
    url: `/api/v1/services/${serviceId}`,
  }, 404);
  const hiddenPublicList = await request(undefined, {
    method: "GET",
    url: `/api/v1/services?search=${search}`,
  }, 200);
  assert.equal(hiddenPublicList.json().data.items.some((item) => item.id === serviceId), false);
  const hiddenAdminList = await request("admin", {
    method: "GET",
    url: `/api/v1/admin/services?search=${search}`,
  }, 200);
  assert.equal(hiddenAdminList.json().data.items.some((item) => item.id === serviceId), true);
  await request("admin", {
    method: "GET",
    url: `/api/v1/admin/services/${serviceId}`,
  }, 200);
  await request("admin", {
    method: "PATCH",
    url: `/api/v1/admin/services/${serviceId}`,
    payload: { isPublic: true },
  }, 200);
  await request("admin", {
    method: "PATCH",
    url: `/api/v1/admin/services/${serviceId}`,
    payload: { isActive: false },
  }, 200);
  await request(undefined, {
    method: "GET",
    url: `/api/v1/services/${serviceId}`,
  }, 404);
  const inactivePublicList = await request(undefined, {
    method: "GET",
    url: `/api/v1/services?search=${search}`,
  }, 200);
  assert.equal(inactivePublicList.json().data.items.some((item) => item.id === serviceId), false);
  const inactiveAdminList = await request("admin", {
    method: "GET",
    url: `/api/v1/admin/services?search=${search}`,
  }, 200);
  assert.equal(inactiveAdminList.json().data.items.some((item) => item.id === serviceId), true);
  await request("admin", {
    method: "GET",
    url: `/api/v1/admin/services/${serviceId}`,
  }, 200);

  await request("contributor", {
    method: "POST",
    url: "/api/v1/admin/services",
    payload: { ...createPayload, name: `${serviceName}_forbidden` },
  }, 403);
  await request("client", {
    method: "POST",
    url: "/api/v1/admin/services",
    payload: { ...createPayload, name: `${serviceName}_client` },
  }, 403);
  await request("admin", {
    method: "POST",
    url: "/api/v1/admin/services",
    payload: createPayload,
  }, 409);
  await request("admin", {
    method: "POST",
    url: "/api/v1/admin/services",
    payload: { name: `${serviceName}_invalid`, category: "automation" },
  }, 400);
  await request("admin", {
    method: "POST",
    url: "/api/v1/admin/services",
    payload: { ...createPayload, name: `${serviceName}_unknown`, unexpected: true },
  }, 400);
  await request("admin", {
    method: "DELETE",
    url: `/api/v1/admin/services/${serviceId}`,
  }, 404);

  const audit = await pool.query(
    `SELECT count(*)::int AS total,
            bool_and(NOT (coalesce(new_values,'{}'::jsonb) ? 'description')) AS no_description,
            bool_and(NOT (coalesce(old_values,'{}'::jsonb) ? 'description')) AS no_old_description
     FROM audit_events WHERE entity_type='service' AND entity_id=$1`,
    [serviceId],
  );
  assert.deepEqual(audit.rows[0], {
    total: 4,
    no_description: true,
    no_old_description: true,
  });
  results.services = {
    createStatus: created.statusCode,
    adminVisible: true,
    publicWhenPublishedAndActive: true,
    hiddenPublicStatus: 404,
    inactivePublicStatus: 404,
    adminVisibleWhenHiddenOrInactive: true,
    withoutPermissionStatus: 403,
    clientStatus: 403,
    duplicateNameStatus: 409,
    invalidBodyStatus: 400,
    unknownFieldStatus: 400,
    deleteRouteStatus: 404,
    auditEvents: 4,
    auditDescriptionRedacted: true,
  };
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM audit_events WHERE actor_user_id = ANY($1::uuid[])",
      [[ids.admin, ids.contributor, ids.client]],
    );
    await client.query(
      `DELETE FROM leads WHERE id = ANY($1::uuid[]) OR email LIKE $2`,
      [Object.values(ids).filter((_, index) => index >= 5), `${tag}%`],
    );
    await client.query(
      `DELETE FROM organization_memberships
       WHERE user_id = ANY($1::uuid[])`,
      [[ids.admin, ids.contributor, ids.client]],
    );
    await client.query(
      `DELETE FROM organizations
       WHERE id=$1 OR name LIKE $2`,
      [ids.reuseOrganization, `${tag}%`],
    );
    await client.query(
      `DELETE FROM services WHERE id=$1 OR name LIKE $2`,
      [ids.seedService, `${tag}%`],
    );
    await client.query(
      "DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])",
      [[ids.admin, ids.contributor, ids.client]],
    );
    await client.query(
      "DELETE FROM app_users WHERE id = ANY($1::uuid[])",
      [[ids.admin, ids.contributor, ids.client]],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const verification = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM leads WHERE email LIKE $1) AS leads,
      (SELECT count(*)::int FROM services WHERE name LIKE $1) AS services,
      (SELECT count(*)::int FROM organizations WHERE name LIKE $1) AS organizations,
      (SELECT count(*)::int FROM app_users WHERE clerk_user_id LIKE $1) AS users,
      (SELECT count(*)::int FROM organization_memberships om
       JOIN app_users u ON u.id=om.user_id WHERE u.clerk_user_id LIKE $1) AS memberships,
      (SELECT count(*)::int FROM audit_events ae
       JOIN app_users u ON u.id=ae.actor_user_id WHERE u.clerk_user_id LIKE $1) AS audit_events,
      (SELECT count(*)::int FROM pg_namespace
       WHERE nspname LIKE 'ilvox_phase45_%' OR nspname LIKE 'ilvox_validation_%') AS temporary_schemas`,
    [`${tag}%`],
  );
  results.cleanup = verification.rows[0];
  assert.deepEqual(verification.rows[0], {
    leads: 0,
    services: 0,
    organizations: 0,
    users: 0,
    memberships: 0,
    audit_events: 0,
    temporary_schemas: 0,
  });
}

try {
  await setup();
  app = await buildApp({
    env: {
      ...process.env,
      CLERK_AUTH_ENABLED: "false",
      CLERK_WEBHOOKS_ENABLED: "false",
    },
    authenticationProvider,
  });
  await smokeStandalone();
  await smokeOrganizationalConversions();
  await smokeServices();
  results.safety.contactsCreated = (
    await pool.query("SELECT to_regclass('public.contacts') AS contacts")
  ).rows[0].contacts === null ? 0 : "not_measured";
} catch (error) {
  failure = error;
} finally {
  if (app !== undefined) await app.close().catch(() => undefined);
  try {
    await cleanup();
  } catch (cleanupError) {
    failure = failure ?? cleanupError;
  }
  await pool.end().catch(() => undefined);
}

if (failure !== undefined) {
  console.error(JSON.stringify({
    ok: false,
    error: failure instanceof Error ? failure.message : String(failure),
    results,
  }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}
