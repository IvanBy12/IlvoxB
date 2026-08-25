/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access -- HTTP contract mocks are intentionally small. */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceNeed, ServiceNeedRepository } from "../../src/modules/service-needs/service-needs.types.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import { actor } from "../helpers/actors.js";

const NEED_ID = "00000000-0000-4000-8000-0000000008b0";
const SERVICE_ID = "00000000-0000-4000-8000-0000000008b1";
const now = new Date("2026-08-04T12:00:00.000Z");
const need: ServiceNeed = {
  id: NEED_ID, code: "sell_online", title: "Vender en línea", shortDescription: "Vender por internet",
  detailedDescription: "Tienda, pagos y pedidos digitales.", iconKey: "shopping-cart", displayOrder: 10,
  isPublic: true, isActive: true, createdAt: now, updatedAt: now,
};

function repository(): ServiceNeedRepository {
  return {
    listPublic: vi.fn(async () => ({ items: [{ id: NEED_ID, code: need.code, title: need.title, shortDescription: need.shortDescription, detailedDescription: need.detailedDescription, iconKey: need.iconKey, displayOrder: need.displayOrder }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })),
    findPublicById: vi.fn(async (id) => id === NEED_ID ? { id: NEED_ID, code: need.code, title: need.title, shortDescription: need.shortDescription, detailedDescription: need.detailedDescription, iconKey: need.iconKey, displayOrder: need.displayOrder } : null),
    listPublicServices: vi.fn(async () => [{ service: { id: SERVICE_ID, name: "Tienda", category: "ecommerce" as const, description: "Comercio" }, weight: 90, isPrimary: true }]),
    listAuthorized: vi.fn(async () => ({ items: [need], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })),
    findAuthorizedById: vi.fn(async () => ({ ...need, services: [] })),
    createAuthorized: vi.fn(async () => need),
    updateAuthorized: vi.fn(async () => need),
    replaceLinksAuthorized: vi.fn(async () => ({ ...need, services: [] })),
  };
}

const authenticated: AuthenticationProvider = { authenticate: () => Promise.resolve({ clerkUserId: "clerk_internal" }) };
const identity: IdentityRepository = {
  findByClerkUserId: () => Promise.resolve({
    actor: { ...actor({ internal: true, permissions: [{ code: "services.read", scopes: ["global"] }, { code: "services.manage", scopes: ["global"] }] }), clerkUserId: "clerk_internal" },
    primaryEmail: "internal@example.test", firstName: "Internal", lastName: "User", avatarUrl: null,
  }),
};

describe("Phase 8B service-needs HTTP routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app !== undefined) await app.close(); app = undefined; });

  it("exposes all eight operations and keeps public reads unauthenticated", async () => {
    app = await buildTestApp({}, { serviceNeedRepository: repository() });
    const routes = app.printRoutes();
    expect(routes).toContain("service-needs (GET, HEAD)");
    expect(routes).toContain(":needId (GET, HEAD)");
    expect(routes).toContain("services (GET, HEAD)");
    expect(routes).toContain("service-needs (GET, HEAD, POST)");
    expect(routes).toContain("services (PUT)");
    expect((await app.inject({ method: "GET", url: "/api/v1/service-needs" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/service-needs/${NEED_ID}` })).statusCode).toBe(200);
    const related = await app.inject({ method: "GET", url: `/api/v1/service-needs/${NEED_ID}/services` });
    expect(related.statusCode).toBe(200);
    expect(related.json().data[0]).toMatchObject({ weight: 90, isPrimary: true });
    expect(related.json().data[0].service).toEqual({ id: SERVICE_ID, name: "Tienda", category: "ecommerce", description: "Comercio" });
  });

  it("uses neutral 404s and rejects unauthenticated administration", async () => {
    app = await buildTestApp({}, { serviceNeedRepository: repository() });
    expect((await app.inject({ method: "GET", url: "/api/v1/service-needs/00000000-0000-4000-8000-000000000999" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/service-needs" })).statusCode).toBe(401);
  });

  it("validates weights, extra properties, and duplicate relationships before mutation", async () => {
    const repo = repository();
    app = await buildTestApp({}, { serviceNeedRepository: repo, authenticationProvider: authenticated, identityRepository: identity });
    const invalid = await app.inject({ method: "PUT", url: `/api/v1/admin/service-needs/${NEED_ID}/services`, payload: { services: [{ serviceId: SERVICE_ID, weight: 101, isPrimary: true }], injected: true } });
    expect(invalid.statusCode).toBe(400);
    const duplicate = await app.inject({ method: "PUT", url: `/api/v1/admin/service-needs/${NEED_ID}/services`, payload: { services: [{ serviceId: SERVICE_ID, weight: 50, isPrimary: true }, { serviceId: SERVICE_ID, weight: 40, isPrimary: false }] } });
    expect(duplicate.statusCode).toBe(400);
    expect(repo.replaceLinksAuthorized).not.toHaveBeenCalled();
  });

  it("rejects manipulated UUIDs and actors without services.manage", async () => {
    const readOnlyIdentity: IdentityRepository = {
      findByClerkUserId: () => Promise.resolve({
        actor: { ...actor({ internal: true, permissions: [{ code: "services.read", scopes: ["global"] }] }), clerkUserId: "clerk_internal" },
        primaryEmail: "reader@example.test", firstName: "Read", lastName: "Only", avatarUrl: null,
      }),
    };
    app = await buildTestApp({}, { serviceNeedRepository: repository(), authenticationProvider: authenticated, identityRepository: readOnlyIdentity });
    expect((await app.inject({ method: "GET", url: "/api/v1/service-needs/not-a-uuid" })).statusCode).toBe(400);
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/service-needs/${NEED_ID}`,
      payload: { displayOrder: 20 },
    })).statusCode).toBe(403);
  });

  it("maps duplicate codes or titles to 409 and missing related services to 400", async () => {
    const repo = repository();
    vi.mocked(repo.createAuthorized).mockResolvedValue("duplicate");
    vi.mocked(repo.replaceLinksAuthorized).mockResolvedValue("service_not_found");
    app = await buildTestApp({}, { serviceNeedRepository: repo, authenticationProvider: authenticated, identityRepository: identity });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/service-needs",
      payload: { code: "sell_online", title: "Vender en línea", shortDescription: "Venta digital", detailedDescription: "Tienda y pagos.", iconKey: "shopping-cart" },
    });
    expect(duplicate.statusCode).toBe(409);
    const missingService = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/service-needs/${NEED_ID}/services`,
      payload: { services: [{ serviceId: SERVICE_ID, weight: 50, isPrimary: false }] },
    });
    expect(missingService.statusCode).toBe(400);
  });

  it("rate limits public need reads at 60 requests per minute", async () => {
    app = await buildTestApp({}, { serviceNeedRepository: repository() });
    for (let requestNumber = 1; requestNumber <= 60; requestNumber += 1) {
      expect((await app.inject({ method: "GET", url: "/api/v1/service-needs" })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/service-needs" })).statusCode).toBe(429);
  });
});
