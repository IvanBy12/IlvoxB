import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationProvider } from "../../src/plugins/clerk.js";
import type { IdentityRepository } from "../../src/modules/identity/identity.types.js";
import type { ProjectRepository } from "../../src/modules/projects/project.types.js";
import type { TaskRepository } from "../../src/modules/tasks/task.types.js";
import { ORG_A, USER_A, USER_B, actor } from "../helpers/actors.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000701";
const TASK_ID = "00000000-0000-4000-8000-000000000702";
const MILESTONE_ID = "00000000-0000-4000-8000-000000000703";
const DELIVERABLE_ID = "00000000-0000-4000-8000-000000000704";
const now = new Date("2026-07-23T12:00:00.000Z");
const project = {
  id: PROJECT_ID,
  organizationId: ORG_A,
  serviceId: null,
  serviceName: null,
  name: "Phase 5",
  description: "Operational project",
  status: "planning" as const,
  priority: "medium" as const,
  leadUserId: USER_B,
  leadUserName: "Lead",
  startDate: "2026-07-23",
  dueDate: "2026-08-23",
  createdByUserId: USER_A,
  createdAt: now,
  updatedAt: now,
};
const task = {
  id: TASK_ID,
  organizationId: null,
  projectId: null,
  title: "Internal task",
  description: "Private",
  assignedToUserId: USER_A,
  assignedToName: "Internal",
  createdByUserId: USER_A,
  priority: "medium" as const,
  status: "pending" as const,
  dueDate: "2026-08-01",
  estimatedMinutes: null,
  createdAt: now,
  updatedAt: now,
};
const member = {
  projectId: PROJECT_ID,
  organizationId: ORG_A,
  userId: USER_B,
  displayName: "Member",
  roleCode: "project_member" as const,
  assignedByUserId: USER_A,
  status: "active" as const,
  revokedAt: null,
  revokedByUserId: null,
  joinedAt: now,
  createdAt: now,
  updatedAt: now,
};
const milestone = {
  id: MILESTONE_ID,
  projectId: PROJECT_ID,
  organizationId: ORG_A,
  name: "Milestone",
  description: null,
  status: "pending" as const,
  dueDate: "2026-08-01",
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const deliverable = {
  id: DELIVERABLE_ID,
  projectId: PROJECT_ID,
  organizationId: ORG_A,
  milestoneId: MILESTONE_ID,
  name: "Deliverable",
  description: null,
  status: "pending" as const,
  approvedByUserId: null,
  approvedAt: null,
  createdAt: now,
  updatedAt: now,
};

const authenticated: AuthenticationProvider = {
  authenticate: () => Promise.resolve({ clerkUserId: "clerk_phase5" }),
};

function identity(
  internal: boolean,
  permissions: readonly { readonly code: string; readonly scopes: readonly ("global" | "organization" | "assigned" | "own")[] }[],
): IdentityRepository {
  return {
    findByClerkUserId: () => Promise.resolve({
      actor: {
        ...actor({ internal, roleCode: internal ? "admin" : "client_manager" }),
        clerkUserId: "clerk_phase5",
        permissions,
      },
      primaryEmail: "phase5@example.test",
      firstName: "Phase",
      lastName: "Five",
      avatarUrl: null,
    }),
  };
}

function projectRepository(): ProjectRepository {
  return {
    listAuthorized: vi.fn(() => Promise.resolve({
      items: [project],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })),
    findAuthorized: vi.fn(() => Promise.resolve(project)),
    getTransitionContext: vi.fn(() => Promise.resolve({
      project,
      incompleteMilestones: 0,
      unapprovedDeliverables: 0,
    })),
    create: vi.fn(() => Promise.resolve(project)),
    update: vi.fn(() => Promise.resolve(project)),
    assignLead: vi.fn(() => Promise.resolve(project)),
    transition: vi.fn(() => Promise.resolve({ ...project, status: "in_progress" as const })),
    listMembers: vi.fn(() => Promise.resolve([])),
    createMember: vi.fn(() => Promise.resolve("conflict" as const)),
    updateMember: vi.fn(() => Promise.resolve("not_found" as const)),
    revokeMember: vi.fn(() => Promise.resolve("not_found" as const)),
    listMilestones: vi.fn(() => Promise.resolve([])),
    findMilestone: vi.fn(() => Promise.resolve(null)),
    createMilestone: vi.fn(() => Promise.resolve("not_found" as const)),
    updateMilestone: vi.fn(() => Promise.resolve("not_found" as const)),
    listDeliverables: vi.fn(() => Promise.resolve([])),
    findDeliverable: vi.fn(() => Promise.resolve(null)),
    createDeliverable: vi.fn(() => Promise.resolve("not_found" as const)),
    updateDeliverable: vi.fn(() => Promise.resolve("not_found" as const)),
  };
}

function taskRepository(): TaskRepository {
  return {
    listAuthorized: vi.fn(() => Promise.resolve({
      items: [task],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    })),
    findAuthorized: vi.fn(() => Promise.resolve(task)),
    create: vi.fn(() => Promise.resolve(task)),
    update: vi.fn(() => Promise.resolve(task)),
    assign: vi.fn(() => Promise.resolve(task)),
    transition: vi.fn(() => Promise.resolve({ ...task, status: "ready" as const })),
  };
}

describe("Phase 5 HTTP contracts", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) await app.close();
  });

  it("creates an organization-bound project with a server-owned initial status", async () => {
    const createProject = vi.fn(() => Promise.resolve(project));
    const projects: ProjectRepository = { ...projectRepository(), create: createProject };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "projects.manage", scopes: ["global"] }]),
      projectRepository: projects,
      taskRepository: taskRepository(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        organizationId: ORG_A,
        name: "Phase 5",
        description: "Operational project",
        leadUserId: USER_B,
        startDate: "2026-07-23",
        dueDate: "2026-08-23",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createProject).toHaveBeenCalledOnce();
  });

  it("rejects protected project fields in generic create and patch bodies", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "projects.manage", scopes: ["global"] }]),
      projectRepository: projectRepository(),
      taskRepository: taskRepository(),
    });
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        organizationId: ORG_A,
        name: "Invalid",
        description: "Invalid",
        leadUserId: USER_B,
        startDate: "2026-07-23",
        dueDate: "2026-08-23",
        status: "delivered",
      },
    });
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}`,
      payload: { status: "cancelled" },
    });
    expect(create.statusCode).toBe(400);
    expect(patch.statusCode).toBe(400);
  });

  it("keeps standalone tasks internal and rejects ticket context", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(false, [{ code: "tasks.manage", scopes: ["global"] }]),
      projectRepository: projectRepository(),
      taskRepository: taskRepository(),
    });
    const standalone = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        title: "Private",
        description: "Private",
        assignedToUserId: USER_A,
        dueDate: "2026-08-01",
      },
    });
    const ticket = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        ticketId: "00000000-0000-4000-8000-000000000799",
        title: "Ticket task",
        description: "Out of phase",
        assignedToUserId: USER_A,
        dueDate: "2026-08-01",
      },
    });
    expect(standalone.statusCode).toBe(403);
    expect(ticket.statusCode).toBe(400);
  });

  it("applies project list pagination, search, filters, and ordering", async () => {
    const listAuthorized = vi.fn(() => Promise.resolve({
      items: [project],
      pagination: { page: 2, pageSize: 10, total: 1, totalPages: 1 },
    }));
    const projects: ProjectRepository = { ...projectRepository(), listAuthorized };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "projects.read", scopes: ["global"] }]),
      projectRepository: projects,
      taskRepository: taskRepository(),
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects?page=2&pageSize=10&search=Phase&status=planning&organizationId=${ORG_A}&leadUserId=${USER_B}&startFrom=2026-07-01&dueTo=2026-09-01&sortBy=name&sortDirection=asc`,
    });
    expect(response.statusCode).toBe(200);
    expect(listAuthorized).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      page: 2,
      pageSize: 10,
      search: "Phase",
      status: "planning",
      organizationId: ORG_A,
      leadUserId: USER_B,
      sortBy: "name",
      sortDirection: "asc",
    }));
  });

  it("hides an out-of-scope project and rejects an invalid transition", async () => {
    const hiddenProjects: ProjectRepository = {
      ...projectRepository(),
      findAuthorized: vi.fn(() => Promise.resolve(null)),
      getTransitionContext: vi.fn(() => Promise.resolve(null)),
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [
        { code: "projects.read", scopes: ["global"] },
        { code: "projects.manage", scopes: ["global"] },
      ]),
      projectRepository: hiddenProjects,
      taskRepository: taskRepository(),
    });
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ID}`,
    })).statusCode).toBe(404);
    await app.close();

    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "projects.manage", scopes: ["global"] }]),
      projectRepository: projectRepository(),
      taskRepository: taskRepository(),
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/transition`,
      payload: { status: "delivered" },
    })).statusCode).toBe(409);
  });

  it("validates project member roles and maps duplicate membership to conflict", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "projects.manage", scopes: ["global"] }]),
      projectRepository: projectRepository(),
      taskRepository: taskRepository(),
    });
    const invalidRole = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      payload: { userId: USER_B, roleCode: "admin" },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      payload: { userId: USER_B, roleCode: "project_member" },
    });
    expect(invalidRole.statusCode).toBe(400);
    expect(duplicate.statusCode).toBe(409);
  });

  it("rejects unavailable deliverable milestone linkage and invalid milestone dates", async () => {
    const projects: ProjectRepository = {
      ...projectRepository(),
      createMilestone: vi.fn(() => Promise.resolve("invalid_dates" as const)),
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "projects.manage", scopes: ["global"] }]),
      projectRepository: projects,
      taskRepository: taskRepository(),
    });
    const milestone = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/milestones`,
      payload: { name: "Outside", dueDate: "2027-01-01" },
    });
    const deliverable = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/deliverables`,
      payload: { name: "Unavailable", milestoneId: "00000000-0000-4000-8000-000000000799" },
    });
    const invalidStatus = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/deliverables`,
      payload: { name: "Invalid status", status: "archived" },
    });
    expect(milestone.statusCode).toBe(400);
    expect(deliverable.statusCode).toBe(404);
    expect(invalidStatus.statusCode).toBe(400);
  });

  it("creates internal standalone/project tasks and rejects contextual PATCH", async () => {
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "tasks.manage", scopes: ["global"] }]),
      projectRepository: projectRepository(),
      taskRepository: taskRepository(),
    });
    const base = {
      title: "Task",
      description: "Task",
      assignedToUserId: USER_A,
      dueDate: "2026-08-01",
    };
    expect((await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: base,
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: { ...base, projectId: PROJECT_ID },
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${TASK_ID}`,
      payload: { projectId: PROJECT_ID },
    })).statusCode).toBe(400);
  });

  it("maps ineligible assignment and validates task transitions", async () => {
    const tasks: TaskRepository = {
      ...taskRepository(),
      assign: vi.fn(() => Promise.resolve("ineligible_user" as const)),
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [{ code: "tasks.manage", scopes: ["global"] }]),
      projectRepository: projectRepository(),
      taskRepository: tasks,
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${TASK_ID}/assign`,
      payload: { assignedToUserId: USER_B },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${TASK_ID}/transition`,
      payload: { status: "completed" },
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${TASK_ID}/transition`,
      payload: { status: "ready" },
    })).statusCode).toBe(200);
  });

  it("covers active member list/create/role update and idempotent revocation responses", async () => {
    const listMembers = vi.fn(() => Promise.resolve([member]));
    const createMember = vi.fn(() => Promise.resolve(member));
    const updateMember = vi.fn(() => Promise.resolve({ ...member, roleCode: "project_lead" as const }));
    const revokeMember = vi.fn(() => Promise.resolve({
      ...member,
      status: "revoked" as const,
      revokedAt: now,
      revokedByUserId: USER_A,
    }));
    const projects: ProjectRepository = {
      ...projectRepository(),
      listMembers,
      createMember,
      updateMember,
      revokeMember,
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [
        { code: "projects.read", scopes: ["global"] },
        { code: "projects.manage", scopes: ["global"] },
      ]),
      projectRepository: projects,
      taskRepository: taskRepository(),
    });
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ID}/members`,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      payload: { userId: USER_B, roleCode: "project_member" },
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}/members/${USER_B}`,
      payload: { roleCode: "project_lead", expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/members/${USER_B}/revoke`,
      payload: { expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect(updateMember).toHaveBeenCalledWith(
      expect.any(Object),
      PROJECT_ID,
      USER_B,
      "project_lead",
      now,
      expect.any(Object),
    );
    expect(revokeMember).toHaveBeenCalledOnce();
  });

  it("covers successful milestone list/detail/create/update and state responses", async () => {
    const projects: ProjectRepository = {
      ...projectRepository(),
      listMilestones: vi.fn(() => Promise.resolve([milestone])),
      findMilestone: vi.fn(() => Promise.resolve(milestone)),
      createMilestone: vi.fn(() => Promise.resolve(milestone)),
      updateMilestone: vi.fn(() => Promise.resolve({
        ...milestone,
        status: "completed" as const,
        completedAt: now,
      })),
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [
        { code: "projects.read", scopes: ["global"] },
        { code: "projects.manage", scopes: ["global"] },
      ]),
      projectRepository: projects,
      taskRepository: taskRepository(),
    });
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ID}/milestones`,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}`,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/milestones`,
      payload: { name: "Milestone", dueDate: "2026-08-01" },
    })).statusCode).toBe(201);
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}`,
      payload: { status: "completed", expectedUpdatedAt: now.toISOString() },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json<{ data: { status: string } }>();
    expect(updatedBody.data.status).toBe("completed");
  });

  it("covers milestone-linked deliverable list/detail/create/update/approval contracts", async () => {
    const createDeliverable = vi.fn(() => Promise.resolve(deliverable));
    const updateDeliverable = vi.fn(() => Promise.resolve({
      ...deliverable,
      status: "approved" as const,
      approvedByUserId: USER_A,
      approvedAt: now,
    }));
    const projects: ProjectRepository = {
      ...projectRepository(),
      listDeliverables: vi.fn(() => Promise.resolve([deliverable])),
      findDeliverable: vi.fn(() => Promise.resolve(deliverable)),
      createDeliverable,
      updateDeliverable,
    };
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [
        { code: "projects.read", scopes: ["global"] },
        { code: "projects.manage", scopes: ["global"] },
      ]),
      projectRepository: projects,
      taskRepository: taskRepository(),
    });
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ID}/deliverables`,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT_ID}/deliverables/${DELIVERABLE_ID}`,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/deliverables`,
      payload: { name: "Deliverable", milestoneId: MILESTONE_ID },
    })).statusCode).toBe(201);
    const approved = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}/deliverables/${DELIVERABLE_ID}`,
      payload: { status: "approved", milestoneId: MILESTONE_ID, expectedUpdatedAt: now.toISOString() },
    });
    expect(approved.statusCode).toBe(200);
    const approvedBody = approved.json<{ data: { status: string } }>();
    expect(approvedBody.data.status).toBe("approved");
    expect(createDeliverable).toHaveBeenCalledWith(
      expect.any(Object),
      PROJECT_ID,
      expect.objectContaining({ milestoneId: MILESTONE_ID }),
      expect.any(Object),
    );
  });

  it("covers successful project/task PATCH and task filter propagation", async () => {
    const updateProject = vi.fn(() => Promise.resolve({ ...project, name: "Patched project" }));
    const listTasks = vi.fn(() => Promise.resolve({
      items: [task],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    }));
    const updateTask = vi.fn(() => Promise.resolve({ ...task, title: "Patched task" }));
    app = await buildTestApp({}, {
      authenticationProvider: authenticated,
      identityRepository: identity(true, [
        { code: "projects.manage", scopes: ["global"] },
        { code: "tasks.read", scopes: ["global"] },
        { code: "tasks.manage", scopes: ["global"] },
      ]),
      projectRepository: { ...projectRepository(), update: updateProject },
      taskRepository: { ...taskRepository(), listAuthorized: listTasks, update: updateTask },
    });
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${PROJECT_ID}`,
      payload: { name: "Patched project", expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${TASK_ID}`,
      payload: { title: "Patched task", expectedUpdatedAt: now.toISOString() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: `/api/v1/tasks?page=1&pageSize=10&search=Internal&status=pending&organizationId=${ORG_A}&projectId=${PROJECT_ID}&assignedToUserId=${USER_A}&createdByUserId=${USER_A}&dueFrom=2026-08-01&dueTo=2026-08-31&sortBy=title&sortDirection=asc`,
    })).statusCode).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      page: 1,
      pageSize: 10,
      search: "Internal",
      status: "pending",
      organizationId: ORG_A,
      projectId: PROJECT_ID,
      assignedToUserId: USER_A,
      createdByUserId: USER_A,
      sortBy: "title",
      sortDirection: "asc",
    }));
  });
});
