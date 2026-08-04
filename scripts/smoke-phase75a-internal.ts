import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  throw new Error("DATABASE_URL_MISSING");
}

const suffix = randomUUID().replaceAll("-", "");
const marker = `PHASE75A_SMOKE_${suffix}`;
const ids = { admin: randomUUID(), clientA: randomUUID(), clientB: randomUUID() };
const clerkIds = {
  admin: `${marker}_admin`,
  clientA: `${marker}_client_a`,
  clientB: `${marker}_client_b`,
};
const pool = new Pool({ connectionString, max: 8 });
const authenticationProvider: AuthenticationProvider = {
  authenticate: (request) => {
    const clerkUserId = request.headers["x-phase75a-smoke-user"];
    return Promise.resolve(typeof clerkUserId === "string" ? { clerkUserId } : null);
  },
};
const app = await buildApp({
  env: {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "3003",
    LOG_LEVEL: "silent",
    TRUST_PROXY: "false",
    CORS_ORIGINS: "http://localhost:5173",
    RATE_LIMIT_MAX: "1000",
  },
  logger: false,
  authenticationProvider,
});

type InjectResponse = { readonly statusCode: number; json<T>(): T };
type Page<T> = { readonly items: readonly T[]; readonly pagination: { readonly page: number; readonly total: number } };
type Service = { readonly id: string; readonly name: string; readonly isPublic: boolean; readonly isActive: boolean };
type Organization = { readonly id: string; readonly name: string; readonly status: string; readonly updatedAt: string };
type Member = { readonly userId: string; readonly status: string; readonly roleCode: string };

const headers = (clerkUserId: string) => ({ "x-phase75a-smoke-user": clerkUserId });
const data = <T>(response: InjectResponse): T => response.json<{ data: T }>().data;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertStatus(response: InjectResponse, expected: number, label: string): void {
  assert(response.statusCode === expected, `${label}_EXPECTED_${expected}_GOT_${response.statusCode}`);
}

const serviceIds: string[] = [];
const organizationIds: string[] = [];
let smokeResult: Record<string, unknown> | undefined;
let smokeError: unknown;
let cleanupError: unknown;

try {
  await pool.query(
    `INSERT INTO app_users (id,clerk_user_id,primary_email,status) VALUES
     ($1,$2,$3,'active'),($4,$5,$6,'active'),($7,$8,$9,'active')`,
    [
      ids.admin, clerkIds.admin, `${marker}_admin@example.test`,
      ids.clientA, clerkIds.clientA, `${marker}_client_a@example.test`,
      ids.clientB, clerkIds.clientB, `${marker}_client_b@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope)
     SELECT $1,r.id,'global' FROM roles r WHERE r.scope='global' AND r.code='super_admin'`,
    [ids.admin],
  );

  const createdServiceResponse = await app.inject({
    method: "POST",
    url: "/api/v1/admin/services",
    headers: headers(clerkIds.admin),
    payload: {
      name: `${marker}_SERVICE`,
      category: "development",
      description: "Phase 7.5A controlled service fixture",
      isPublic: true,
      isActive: true,
    },
  });
  assertStatus(createdServiceResponse, 201, "SERVICE_CREATE");
  const service = data<Service>(createdServiceResponse);
  serviceIds.push(service.id);

  const serviceList = await app.inject({
    method: "GET",
    url: `/api/v1/admin/services?page=1&pageSize=1&search=${marker}&category=development&isPublic=true&isActive=true`,
    headers: headers(clerkIds.admin),
  });
  assertStatus(serviceList, 200, "SERVICE_LIST");
  assert(data<Page<Service>>(serviceList).items[0]?.id === service.id, "SERVICE_LIST_FILTER_MISMATCH");
  const serviceDetail = await app.inject({
    method: "GET",
    url: `/api/v1/admin/services/${service.id}`,
    headers: headers(clerkIds.admin),
  });
  assertStatus(serviceDetail, 200, "SERVICE_DETAIL");
  const publicVisible = await app.inject({ method: "GET", url: `/api/v1/services/${service.id}` });
  assertStatus(publicVisible, 200, "SERVICE_PUBLIC_VISIBLE");

  const duplicateService = await app.inject({
    method: "POST",
    url: "/api/v1/admin/services",
    headers: headers(clerkIds.admin),
    payload: {
      name: `${marker}_SERVICE`,
      category: "support",
      description: "Duplicate fixture",
    },
  });
  assertStatus(duplicateService, 409, "SERVICE_DUPLICATE");
  const serviceForbidden = await app.inject({
    method: "GET",
    url: "/api/v1/admin/services",
    headers: headers(clerkIds.clientA),
  });
  assertStatus(serviceForbidden, 403, "SERVICE_FORBIDDEN");
  const serviceMissing = await app.inject({
    method: "GET",
    url: `/api/v1/admin/services/${randomUUID()}`,
    headers: headers(clerkIds.admin),
  });
  assertStatus(serviceMissing, 404, "SERVICE_NOT_FOUND");

  const hiddenResponse = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/services/${service.id}`,
    headers: headers(clerkIds.admin),
    payload: { isPublic: false },
  });
  assertStatus(hiddenResponse, 200, "SERVICE_HIDE");
  assertStatus(await app.inject({ method: "GET", url: `/api/v1/services/${service.id}` }), 404, "SERVICE_PUBLIC_HIDDEN");
  const inactiveResponse = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/services/${service.id}`,
    headers: headers(clerkIds.admin),
    payload: { name: `${marker}_SERVICE_EDITED`, isPublic: true, isActive: false },
  });
  assertStatus(inactiveResponse, 200, "SERVICE_EDIT_DEACTIVATE");
  assertStatus(await app.inject({ method: "GET", url: `/api/v1/services/${service.id}` }), 404, "SERVICE_PUBLIC_INACTIVE");
  const activeResponse = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/services/${service.id}`,
    headers: headers(clerkIds.admin),
    payload: { isActive: true },
  });
  assertStatus(activeResponse, 200, "SERVICE_ACTIVATE");
  assertStatus(await app.inject({ method: "GET", url: `/api/v1/services/${service.id}` }), 200, "SERVICE_PUBLIC_RESTORED");

  const createOrganization = async (label: string, taxId: string): Promise<Organization> => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: headers(clerkIds.admin),
      payload: {
        name: `${marker}_${label}`,
        legalName: `${marker}_${label}_LEGAL`,
        industry: "Technology",
        size: "small",
        countryCode: "CO",
        taxId,
      },
    });
    assertStatus(response, 201, `ORGANIZATION_CREATE_${label}`);
    const organization = data<Organization>(response);
    organizationIds.push(organization.id);
    return organization;
  };
  const organizationA = await createOrganization("ORG_A", `${marker}_NIT_A`);
  const organizationB = await createOrganization("ORG_B", `${marker}_NIT_B`);

  const organizationList = await app.inject({
    method: "GET",
    url: `/api/v1/organizations?page=1&pageSize=1&search=${marker}_ORG&status=active`,
    headers: headers(clerkIds.admin),
  });
  assertStatus(organizationList, 200, "ORGANIZATION_LIST");
  const organizationPage = data<Page<Organization>>(organizationList);
  assert(organizationPage.items.length === 1 && organizationPage.pagination.total === 2, "ORGANIZATION_PAGINATION_MISMATCH");
  assertStatus(await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationA.id}`, headers: headers(clerkIds.admin) }), 200, "ORGANIZATION_DETAIL");
  const organizationUpdate = await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${organizationA.id}`,
    headers: headers(clerkIds.admin),
    payload: { industry: "Digital services", status: "inactive" },
  });
  assertStatus(organizationUpdate, 200, "ORGANIZATION_UPDATE");
  assert(data<Organization>(organizationUpdate).status === "inactive", "ORGANIZATION_UPDATE_NOT_APPLIED");
  assertStatus(await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${organizationA.id}`,
    headers: headers(clerkIds.admin),
    payload: { status: "active" },
  }), 200, "ORGANIZATION_REACTIVATE");
  const duplicateOrganization = await app.inject({
    method: "POST",
    url: "/api/v1/organizations",
    headers: headers(clerkIds.admin),
    payload: { name: `${marker}_DUPLICATE`, countryCode: "CO", taxId: `${marker}_NIT_A` },
  });
  assertStatus(duplicateOrganization, 409, "ORGANIZATION_DUPLICATE");
  const organizationForbidden = await app.inject({
    method: "POST",
    url: "/api/v1/organizations",
    headers: headers(clerkIds.clientA),
    payload: { name: `${marker}_FORBIDDEN` },
  });
  assertStatus(organizationForbidden, 403, "ORGANIZATION_FORBIDDEN");
  assertStatus(await app.inject({ method: "GET", url: `/api/v1/organizations/${randomUUID()}`, headers: headers(clerkIds.admin) }), 404, "ORGANIZATION_NOT_FOUND");

  await pool.query(
    `INSERT INTO organization_memberships (
       organization_id,user_id,role_id,role_scope,status,activated_at
     )
     SELECT fixture.organization_id,fixture.user_id,r.id,'organization','active',now()
     FROM (VALUES ($1::uuid,$2::uuid),($3::uuid,$4::uuid)) fixture(organization_id,user_id)
     JOIN roles r ON r.scope='organization' AND r.code='client_contact'`,
    [organizationA.id, ids.clientA, organizationB.id, ids.clientB],
  );
  const membersResponse = await app.inject({
    method: "GET",
    url: `/api/v1/organizations/${organizationA.id}/members`,
    headers: headers(clerkIds.admin),
  });
  assertStatus(membersResponse, 200, "MEMBERS_LIST");
  assert(data<readonly Member[]>(membersResponse).some((item) => item.userId === ids.clientA), "MEMBER_A_MISSING");
  const memberUpdate = await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${organizationA.id}/members/${ids.clientA}`,
    headers: headers(clerkIds.admin),
    payload: { jobTitle: "Controlled contact", phone: "+57 300 000 0000" },
  });
  assertStatus(memberUpdate, 200, "MEMBER_UPDATE");

  const ownOrganization = await app.inject({
    method: "GET",
    url: `/api/v1/organizations/${organizationA.id}`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(ownOrganization, 200, "OWN_TENANT_ALLOWED");
  const crossTenant = await app.inject({
    method: "GET",
    url: `/api/v1/organizations/${organizationB.id}`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(crossTenant, 403, "CROSS_TENANT_DENIED");

  const memberRevoke = await app.inject({
    method: "PATCH",
    url: `/api/v1/organizations/${organizationA.id}/members/${ids.clientA}`,
    headers: headers(clerkIds.admin),
    payload: { status: "revoked" },
  });
  assertStatus(memberRevoke, 200, "MEMBER_REVOKE");
  assert(data<Member>(memberRevoke).status === "revoked", "MEMBER_NOT_REVOKED");

  const revokedAccess = await app.inject({
    method: "GET",
    url: `/api/v1/organizations/${organizationA.id}`,
    headers: headers(clerkIds.clientA),
  });
  assertStatus(revokedAccess, 403, "REVOKED_MEMBER_LOSES_ORGANIZATION_PERMISSION");

  smokeResult = {
    marker,
    services: { create: 201, list: 200, detail: 200, duplicate: 409, forbidden: 403, missing: 404, publicVisibility: "active_and_public_only" },
    organizations: { create: 201, list: 200, paginationTotal: 2, detail: 200, update: 200, duplicate: 409, forbidden: 403, missing: 404 },
    memberships: { list: 200, update: 200, revoke: 200, revokedAccess: 403 },
    crossTenant: { backendStatus: 403, frontendPresentation: "Recurso no disponible" },
  };
} catch (error) {
  smokeError = error;
} finally {
  try {
    await pool.query("BEGIN");
    await pool.query(
      `DELETE FROM audit_events
       WHERE organization_id = ANY($1::uuid[])
          OR entity_id = ANY($2::uuid[])
          OR actor_user_id = ANY($3::uuid[])`,
      [organizationIds, [...organizationIds, ...serviceIds], [ids.admin, ids.clientA, ids.clientB]],
    );
    await pool.query("DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
    await pool.query("DELETE FROM services WHERE id = ANY($1::uuid[])", [serviceIds]);
    await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])", [[ids.admin, ids.clientA, ids.clientB]]);
    await pool.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [[ids.admin, ids.clientA, ids.clientB]]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    cleanupError = error;
  }
  const residual = await pool.query<{ readonly total: number }>(
    `SELECT (
       (SELECT count(*) FROM services WHERE name LIKE $1) +
       (SELECT count(*) FROM organizations WHERE name LIKE $1) +
       (SELECT count(*) FROM app_users WHERE clerk_user_id LIKE $1)
     )::int AS total`,
    [`${marker}%`],
  ).catch(() => ({ rows: [{ total: -1 }] }));
  console.log(JSON.stringify({ ...smokeResult, residualFixtures: residual.rows[0]?.total ?? -1 }, null, 2));
  await app.close();
  await pool.end();
}

if (smokeError !== undefined) {
  throw smokeError instanceof Error ? smokeError : new Error("Smoke failed with a non-Error value", { cause: smokeError });
}
if (cleanupError !== undefined) {
  throw cleanupError instanceof Error ? cleanupError : new Error("Cleanup failed with a non-Error value", { cause: cleanupError });
}
