import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import type { TicketRepository } from "../../src/modules/tickets/ticket.types.js";
import { USER_A, USER_B, actor } from "../helpers/actors.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const TICKET_ID = "00000000-0000-4000-8000-000000000801";
const now = new Date("2026-07-27T12:00:00.000Z");
const ticket = {
  id: TICKET_ID,
  organizationId: null,
  projectId: null,
  requesterUserId: USER_A,
  assignedToUserId: null,
  code: "TCK-2026-000001",
  type: "incident" as const,
  requestedPriority: "medium" as const,
  priority: "medium" as const,
  status: "new" as const,
  subject: "Standalone",
  description: "Private ticket",
  resolution: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: now,
  updatedAt: now,
};
const comment = {
  id: "00000000-0000-4000-8000-000000000802",
  ticketId: TICKET_ID,
  organizationId: null,
  authorUserId: USER_A,
  visibility: "client" as const,
  content: "More details",
  createdAt: now,
  updatedAt: now,
};
const authenticated: AuthenticationProvider = {
  authenticate: () => Promise.resolve({ clerkUserId: "clerk_phase6" }),
};

function identity(permissions: readonly { code: string; scopes: readonly ("global" | "assigned" | "own")[] }[] = []): IdentityRepository {
  return {
    findByClerkUserId: () => Promise.resolve({
      actor: {
        ...actor({ internal: permissions.some((permission) => permission.scopes.includes("global")) }),
        clerkUserId: "clerk_phase6",
        permissions,
      },
      primaryEmail: "phase6@example.test",
      firstName: "Phase",
      lastName: "Six",
      avatarUrl: null,
    }),
  };
}

function repository(): TicketRepository {
  return {
    listAuthorized: vi.fn(() => Promise.resolve({
      items: [ticket],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })),
    findAuthorized: vi.fn(() => Promise.resolve(ticket)),
    create: vi.fn(() => Promise.resolve(ticket)),
    update: vi.fn(() => Promise.resolve(ticket)),
    assign: vi.fn(() => Promise.resolve({ ...ticket, assignedToUserId: USER_B })),
    changePriority: vi.fn(() => Promise.resolve({ ...ticket, priority: "high" as const })),
    transition: vi.fn(() => Promise.resolve({ ...ticket, status: "classifying" as const })),
    confirmResolution: vi.fn(() => Promise.resolve({ ...ticket, status: "closed" as const, closedAt: now })),
    listComments: vi.fn(() => Promise.resolve([comment])),
    createComment: vi.fn(() => Promise.resolve(comment)),
  };
}

describe("Phase 6 ticket HTTP contracts", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) await app.close();
  });

  it("creates a standalone ticket for an active local user and derives requester", async () => {
    const createTicket = vi.fn<TicketRepository["create"]>(() => Promise.resolve(ticket));
    const tickets: TicketRepository = { ...repository(), create: createTicket };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      ticketRepository: tickets,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tickets",
      payload: {
        type: "incident",
        subject: "Standalone",
        description: "Private ticket",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createTicket).toHaveBeenCalledOnce();
    expect(createTicket.mock.calls[0]?.[0]).toMatchObject({ kind: "own", actorId: USER_A });
    expect(createTicket.mock.calls[0]?.[1]).not.toHaveProperty("requesterUserId");
    expect(createTicket.mock.calls[0]?.[2]).toBe(USER_A);
  });

  it("rejects requester, state, code and unknown fields controlled by the body", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      ticketRepository: repository(),
    });
    for (const protectedField of ["requesterUserId", "status", "code", "unexpected"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tickets",
        payload: {
          type: "incident",
          subject: "Invalid",
          description: "Invalid",
          [protectedField]: protectedField === "status" ? "closed" : USER_B,
        },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("propagates list filters and whitelist ordering under the repository scope", async () => {
    const listAuthorized = vi.fn(() => Promise.resolve({
      items: [ticket],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }));
    const tickets: TicketRepository = { ...repository(), listAuthorized };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      ticketRepository: tickets,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tickets?page=2&pageSize=10&search=private&status=new&priority=medium&sortBy=updatedAt&sortDirection=asc",
    });
    expect(response.statusCode).toBe(200);
    expect(listAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "own" }),
      expect.objectContaining({
        page: 2,
        pageSize: 10,
        search: "private",
        status: "new",
        priority: "medium",
        sortBy: "updatedAt",
        sortDirection: "asc",
      }),
    );
  });

  it("enforces protected PATCH fields and explicit assignment/priority operations", async () => {
    const tickets = repository();
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity([
        { code: "tickets.update", scopes: ["global"] },
        { code: "tickets.assign", scopes: ["global"] },
        { code: "tickets.change_priority", scopes: ["global"] },
      ]),
      ticketRepository: tickets,
    });
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/tickets/${TICKET_ID}`,
      payload: { status: "resolved" },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/assign`,
      payload: { assignedToUserId: USER_B, expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/priority`,
      payload: { priority: "high", expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
  });

  it("validates transitions before mutation", async () => {
    const tickets = repository();
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity([
        { code: "tickets.change_status", scopes: ["global"] },
        { code: "tickets.close", scopes: ["global"] },
      ]),
      ticketRepository: tickets,
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/transition`,
      payload: { status: "closed" },
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/transition`,
      payload: { status: "classifying" },
    })).statusCode).toBe(200);
  });

  it("creates and lists client-visible comments without body-controlled author", async () => {
    const createComment = vi.fn(() => Promise.resolve(comment));
    const tickets: TicketRepository = { ...repository(), createComment };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      ticketRepository: tickets,
    });
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/tickets/${TICKET_ID}/comments`,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/comments`,
      payload: { content: "More details" },
    })).statusCode).toBe(201);
    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "own" }),
      TICKET_ID,
      USER_A,
      "client",
      "More details",
      expect.any(Object),
    );
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/comments`,
      payload: { content: "No", authorUserId: USER_B },
    })).statusCode).toBe(400);
  });

  it("maps a requester reopen intent to reopened without accepting a target status", async () => {
    const closed = { ...ticket, status: "closed" as const, closedAt: now };
    const transition = vi.fn<TicketRepository["transition"]>(() => Promise.resolve({
      ...closed,
      status: "reopened" as const,
      closedAt: null,
    }));
    const tickets: TicketRepository = {
      ...repository(),
      findAuthorized: vi.fn(() => Promise.resolve(closed)),
      transition,
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      ticketRepository: tickets,
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/reopen`,
      payload: { reason: "Issue returned", expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "own" }),
      TICKET_ID,
      "closed",
      "reopened",
      undefined,
      "Issue returned",
      now,
      expect.any(Object),
    );
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/reopen`,
      payload: { reason: "Issue returned", status: "new" },
    })).statusCode).toBe(400);
  });

  it("confirms or rejects only a resolved ticket through the explicit decision route", async () => {
    const resolved = {
      ...ticket,
      status: "resolved" as const,
      resolution: "Corrected",
      resolvedAt: now,
    };
    const confirmResolution = vi.fn<TicketRepository["confirmResolution"]>(() => Promise.resolve({
      ...resolved,
      status: "closed" as const,
      closedAt: now,
    }));
    const tickets: TicketRepository = {
      ...repository(),
      findAuthorized: vi.fn(() => Promise.resolve(resolved)),
      confirmResolution,
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(),
      ticketRepository: tickets,
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/confirm`,
      payload: { decision: "confirm", expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tickets/${TICKET_ID}/confirm`,
      payload: { decision: "reject" },
    })).statusCode).toBe(409);
    expect(confirmResolution).toHaveBeenCalledOnce();
  });
});
