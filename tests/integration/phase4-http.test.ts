import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository, LocalIdentityProfile } from "../../src/modules/identity/identity.types.js";
import type { ServiceCatalogRepository } from "../../src/modules/services/service-catalog.types.js";
import type { LeadRepository, PublicLeadInput } from "../../src/modules/leads/lead.types.js";
import type { OrganizationRepository } from "../../src/modules/organizations/organization.types.js";
import { actor } from "../helpers/actors.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const SERVICE_ID = "00000000-0000-4000-8000-000000000401";
const LEAD_ID = "00000000-0000-4000-8000-000000000501";
const now = new Date("2026-07-23T12:00:00.000Z");
const catalogItem = {
  id: SERVICE_ID,
  name: "Development",
  category: "development" as const,
  description: "Secure application development",
  isPublic: true,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};
const leadRecord = {
  id: LEAD_ID,
  fullName: "Person",
  companyName: "Company",
  email: "person@example.test",
  phone: null,
  serviceId: SERVICE_ID,
  serviceName: "Development",
  message: "I need a secure application.",
  source: "contact" as const,
  status: "new" as const,
  assignedToUserId: null,
  assignedToName: null,
  convertedOrganizationId: null,
  convertedOrganizationName: null,
  convertedAt: null,
  createdAt: now,
  updatedAt: now,
};

const authenticated: AuthenticationProvider = {
  authenticate: () => Promise.resolve({ clerkUserId: "clerk_test" }),
};

function identityRepository(
  permissions: LocalIdentityProfile["actor"]["permissions"],
  options: { readonly internal?: boolean; readonly roleCode?: string } = {},
): IdentityRepository {
  return {
    findByClerkUserId: () => Promise.resolve({
      actor: {
        ...actor({
          internal: options.internal ?? true,
          ...(options.roleCode === undefined ? {} : { roleCode: options.roleCode }),
          permissions,
        }),
        clerkUserId: "clerk_test",
      },
      primaryEmail: "internal@example.test",
      firstName: "Internal",
      lastName: "User",
      avatarUrl: null,
    }),
  };
}

function dependencies(createPublic: LeadRepository["createPublic"]) {
  const services: ServiceCatalogRepository = {
    listPublic: () => Promise.resolve({
      items: [catalogItem],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    findPublicById: (id) => Promise.resolve(id === SERVICE_ID ? catalogItem : null),
    listAuthorized: () => Promise.resolve({
      items: [catalogItem],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    findAuthorizedById: (scope, id) => Promise.resolve(scope.kind === "global" && id === SERVICE_ID
      ? catalogItem
      : null),
    createAuthorized: () => Promise.resolve(catalogItem),
    updateAuthorized: () => Promise.resolve(catalogItem),
  };
  const leads: LeadRepository = {
    createPublic,
    listAuthorized: () => Promise.resolve({
      items: [leadRecord],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    findAuthorized: () => Promise.resolve({ ...leadRecord, history: [] }),
    updateCommercial: () => Promise.resolve(leadRecord),
    transition: () => Promise.resolve(leadRecord),
    assign: () => Promise.resolve(leadRecord),
    convert: () => Promise.resolve({
      mode: "standalone",
      leadId: LEAD_ID,
      organizationCreated: false,
      organizationId: null,
      status: "converted",
      idempotent: false,
      primaryContactCreated: false,
    }),
  };
  const organizations: OrganizationRepository = {
    listAuthorized: () => Promise.resolve({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }),
    findAuthorized: () => Promise.resolve(null),
    create: () => Promise.resolve("duplicate"),
    updateAuthorized: () => Promise.resolve(null),
    listMembers: () => Promise.resolve(null),
    createMember: () => Promise.resolve(null),
    updateMember: () => Promise.resolve(null),
  };
  return { serviceCatalogRepository: services, leadRepository: leads, organizationRepository: organizations };
}

describe("Phase 4 HTTP routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
  });

  it("registers the versioned Phase 4 route surface", async () => {
    app = await buildTestApp({}, dependencies(() => Promise.resolve(leadRecord)));
    const routes = app.printRoutes();
    expect(routes).toContain("api/v1/");
    expect(routes).toContain("services (GET");
    expect(routes).toContain("leads (POST, GET");
    expect(routes).toContain("organizations (GET");
    expect(routes).not.toContain("contacts");
  });

  it("returns only the repository-approved public catalog without authentication", async () => {
    app = await buildTestApp({}, dependencies(() => Promise.resolve(leadRecord)));
    const response = await app.inject({ method: "GET", url: "/api/v1/services" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { items: [{ id: SERVICE_ID, isActive: true }] } });
  });

  it("passes public service pagination and category filters to the repository", async () => {
    const deps = dependencies(() => Promise.resolve(leadRecord));
    const listPublic = vi.spyOn(deps.serviceCatalogRepository, "listPublic");
    app = await buildTestApp({}, deps);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/services?page=2&pageSize=5&category=development",
    });
    expect(response.statusCode).toBe(200);
    expect(listPublic).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      category: "development",
    });
  });

  it("returns public service detail and a neutral 404 without authentication", async () => {
    app = await buildTestApp({}, dependencies(() => Promise.resolve(leadRecord)));
    const found = await app.inject({
      method: "GET",
      url: `/api/v1/services/${SERVICE_ID}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ data: { id: SERVICE_ID, isPublic: true } });

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/services/00000000-0000-4000-8000-000000000499",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("forces public lead status and assignment in the service contract", async () => {
    const createPublic = vi.fn<(input: PublicLeadInput) => Promise<typeof leadRecord>>(
      () => Promise.resolve(leadRecord),
    );
    app = await buildTestApp({}, dependencies(createPublic));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/leads",
      payload: {
        fullName: " Person ",
        companyName: " Company ",
        email: "PERSON@EXAMPLE.TEST",
        serviceId: SERVICE_ID,
        message: " I need a secure application. ",
        source: "contact",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createPublic).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "Person",
      email: "person@example.test",
      source: "contact",
    }), expect.anything());
    const input = createPublic.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("assignedToUserId");
  });

  it("rejects protected public lead fields and malformed input", async () => {
    const createPublic = vi.fn(() => Promise.resolve(leadRecord));
    app = await buildTestApp({}, dependencies(createPublic));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/leads",
      payload: {
        fullName: "Person",
        email: "person@example.test",
        message: "Message",
        source: "contact",
        status: "approved",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(createPublic).not.toHaveBeenCalled();
  });

  it("maps a missing selected public service to 404", async () => {
    app = await buildTestApp({}, dependencies(() =>
      Promise.reject(Object.assign(new Error("service_not_found"), {
        code: "ILVOX_SERVICE_NOT_FOUND",
      })),
    ));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/leads",
      payload: {
        fullName: "Person",
        email: "person@example.test",
        message: "Message",
        source: "diagnostic",
        serviceId: SERVICE_ID,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it.each([
    ["ILVOX_DIAGNOSTIC_NOT_FOUND", 404],
    ["ILVOX_DIAGNOSTIC_EXPIRED", 409],
    ["ILVOX_DIAGNOSTIC_CLAIMED", 409],
  ])("maps diagnostic association failure %s", async (code, statusCode) => {
    const createPublic = vi.fn(() => Promise.reject(Object.assign(new Error(code), { code })));
    app = await buildTestApp({}, dependencies(createPublic));
    const response = await app.inject({ method: "POST", url: "/api/v1/leads", payload: {
      fullName: "Person", email: "person@example.test", message: "Message", source: "diagnostic",
      diagnosticId: "00000000-0000-4000-8000-000000008c99",
    } });
    expect(response.statusCode).toBe(statusCode);
  });

  it("accepts diagnosticId only for diagnostic source", async () => {
    const createPublic = vi.fn(() => Promise.resolve(leadRecord));
    app = await buildTestApp({}, dependencies(createPublic));
    const response = await app.inject({ method: "POST", url: "/api/v1/leads", payload: {
      fullName: "Person", email: "person@example.test", message: "Message", source: "contact",
      diagnosticId: "00000000-0000-4000-8000-000000008c99",
    } });
    expect(response.statusCode).toBe(400);
    expect(createPublic).not.toHaveBeenCalled();
  });

  it("enforces the public lead rate limit and exposes Retry-After", async () => {
    app = await buildTestApp({}, dependencies(() => Promise.resolve(leadRecord)));
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await app.inject({
        method: "POST",
        url: "/api/v1/leads",
        payload: {
          fullName: `Person ${index}`,
          email: `person-${index}@example.test`,
          message: "Message",
          source: "quotation",
        },
      }));
    }
    expect(responses.slice(0, 10).every((response) => response.statusCode === 201)).toBe(true);
    expect(responses[10]!.statusCode, responses[10]!.body).toBe(429);
    expect(responses[10]!.headers["retry-after"]).toBeDefined();
    expect(responses[10]!.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("returns 413 before processing an oversized public lead body", async () => {
    const createPublic = vi.fn(() => Promise.resolve(leadRecord));
    app = await buildTestApp(
      { BODY_LIMIT_BYTES: "1024" },
      dependencies(createPublic),
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/leads",
      payload: {
        fullName: "Person",
        email: "person@example.test",
        message: "x".repeat(2_000),
        source: "contact",
      },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(createPublic).not.toHaveBeenCalled();
  });

  it("requires a real global permission for administrative service reads", async () => {
    app = await buildTestApp({}, {
      ...dependencies(() => Promise.resolve(leadRecord)),
      authenticationProvider: authenticated,
      identityRepository: identityRepository([]),
    });
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/services" })).statusCode).toBe(403);
  });

  it("permits internal lead listing only with leads.read", async () => {
    app = await buildTestApp({}, {
      ...dependencies(() => Promise.resolve(leadRecord)),
      authenticationProvider: authenticated,
      identityRepository: identityRepository([{ code: "leads.read", scopes: ["global"] }]),
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/leads" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { items: [{ id: LEAD_ID }] } });
  });

  it("returns the stored diagnostic snapshot only through the lead read scope", async () => {
    const deps = dependencies(() => Promise.resolve(leadRecord));
    deps.leadRepository.findDiagnosticAuthorized = vi.fn(() => Promise.resolve({
      id: "00000000-0000-4000-8000-000000008c99", completedAt: now, expiresAt: new Date(now.getTime() + 1_000),
      resultSnapshot: {
        engineVersion: 1, ruleSetId: "00000000-0000-4000-8000-000000008c00", ruleSetTitle: "Motor", completedAt: now.toISOString(), answers: [],
        primaryNeed: null, secondaryNeeds: [], primaryService: null, complementaryServices: [], reasons: [], summary: "Snapshot", disclaimer: "Orientativo",
      },
    }));
    app = await buildTestApp({}, { ...deps, authenticationProvider: authenticated, identityRepository: identityRepository([{ code: "leads.read", scopes: ["global"] }]) });
    expect((await app.inject({ method: "GET", url: `/api/v1/leads/${LEAD_ID}/diagnostic` })).json()).toMatchObject({ data: { resultSnapshot: { summary: "Snapshot" } } });
    await app.close(); app = undefined;
    app = await buildTestApp({}, { ...deps, authenticationProvider: authenticated, identityRepository: identityRepository([]) });
    expect((await app.inject({ method: "GET", url: `/api/v1/leads/${LEAD_ID}/diagnostic` })).statusCode).toBe(403);
  });

  for (const roleCode of ["super_admin", "admin"] as const) {
    it(`${roleCode} creates a service with services.manage`, async () => {
      app = await buildTestApp({}, {
        ...dependencies(() => Promise.resolve(leadRecord)),
        authenticationProvider: authenticated,
        identityRepository: identityRepository(
          [{ code: "services.manage", scopes: ["global"] }],
          { roleCode },
        ),
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/services",
        payload: {
          name: "Managed service",
          category: "development",
          description: "Managed service description",
          isPublic: true,
          isActive: true,
        },
      });
      expect(response.statusCode).toBe(201);
    });
  }

  it("rejects service creation without permission and for a client actor", async () => {
    for (const profile of [
      identityRepository([]),
      identityRepository(
        [{ code: "services.manage", scopes: ["global"] }],
        { internal: false, roleCode: "client_manager" },
      ),
    ]) {
      app = await buildTestApp({}, {
        ...dependencies(() => Promise.resolve(leadRecord)),
        authenticationProvider: authenticated,
        identityRepository: profile,
      });
      expect((await app.inject({
        method: "POST",
        url: "/api/v1/admin/services",
        payload: {
          name: "Forbidden service",
          category: "support",
          description: "Must not be created",
        },
      })).statusCode).toBe(403);
      await app.close();
      app = undefined;
    }
  });

  it("rejects unknown administrative service fields", async () => {
    app = await buildTestApp({}, {
      ...dependencies(() => Promise.resolve(leadRecord)),
      authenticationProvider: authenticated,
      identityRepository: identityRepository(
        [{ code: "services.manage", scopes: ["global"] }],
        { roleCode: "admin" },
      ),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/services",
      payload: {
        name: "Managed service",
        category: "development",
        description: "Managed service description",
        unexpected: true,
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("converts standalone with leads.manage and no organization permission", async () => {
    const deps = dependencies(() => Promise.resolve(leadRecord));
    const convert = vi.spyOn(deps.leadRepository, "convert");
    app = await buildTestApp({}, {
      ...deps,
      authenticationProvider: authenticated,
      identityRepository: identityRepository([{ code: "leads.manage", scopes: ["global"] }]),
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/leads/${LEAD_ID}/convert`,
      payload: { mode: "standalone" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        mode: "standalone",
        organizationCreated: false,
        organizationId: null,
      },
    });
    expect(convert.mock.calls[0]?.[1]).toBeUndefined();
  });
});
