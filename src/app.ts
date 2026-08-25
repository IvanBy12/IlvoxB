import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { loadEnv } from "./config/env.js";
import { SENSITIVE_LOG_PATHS } from "./config/constants.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { securityPlugin } from "./plugins/security.js";
import { databasePlugin } from "./plugins/database.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { HealthService } from "./modules/health/health.service.js";
import type { AuthenticationProvider } from "./plugins/clerk.js";
import { clerkIntegrationPlugin } from "./plugins/clerk.js";
import { authContextPlugin } from "./plugins/auth-context.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import { PostgresIdentityRepository } from "./modules/identity/identity.repository.js";
import type { IdentityRepository } from "./modules/identity/identity.types.js";
import { identityRoutes } from "./modules/identity/identity.routes.js";
import type { ClerkWebhookProcessor, ClerkWebhookVerifier } from "./modules/webhooks/clerk-webhook.types.js";
import { OfficialClerkWebhookVerifier } from "./modules/webhooks/clerk-webhook.verifier.js";
import { ClerkWebhookService } from "./modules/webhooks/clerk-webhook.service.js";
import { clerkWebhookRoutes } from "./modules/webhooks/clerk-webhook.routes.js";
import { AuthorizationService } from "./common/auth/authorization.service.js";
import type { ServiceCatalogRepository } from "./modules/services/service-catalog.types.js";
import { PostgresServiceCatalogRepository } from "./modules/services/service-catalog.repository.js";
import { ServiceCatalogService } from "./modules/services/service-catalog.service.js";
import { serviceCatalogRoutes } from "./modules/services/service-catalog.routes.js";
import type { ServiceNeedRepository } from "./modules/service-needs/service-needs.types.js";
import { PostgresServiceNeedRepository } from "./modules/service-needs/service-needs.repository.js";
import { ServiceNeedService } from "./modules/service-needs/service-needs.service.js";
import { serviceNeedRoutes } from "./modules/service-needs/service-needs.routes.js";
import type { LeadRepository } from "./modules/leads/lead.types.js";
import { PostgresLeadRepository } from "./modules/leads/lead.repository.js";
import { LeadService } from "./modules/leads/lead.service.js";
import { leadRoutes } from "./modules/leads/lead.routes.js";
import type { OrganizationRepository } from "./modules/organizations/organization.types.js";
import { PostgresOrganizationRepository } from "./modules/organizations/organization.repository.js";
import { OrganizationService } from "./modules/organizations/organization.service.js";
import { organizationRoutes } from "./modules/organizations/organization.routes.js";
import type { ProjectRepository } from "./modules/projects/project.types.js";
import { PostgresProjectRepository } from "./modules/projects/project.repository.js";
import { ProjectService } from "./modules/projects/project.service.js";
import { projectRoutes } from "./modules/projects/project.routes.js";
import type { TaskRepository } from "./modules/tasks/task.types.js";
import { PostgresTaskRepository } from "./modules/tasks/task.repository.js";
import { TaskService } from "./modules/tasks/task.service.js";
import { taskRoutes } from "./modules/tasks/task.routes.js";
import type { TicketRepository } from "./modules/tickets/ticket.types.js";
import { PostgresTicketRepository } from "./modules/tickets/ticket.repository.js";
import { TicketService } from "./modules/tickets/ticket.service.js";
import { ticketRoutes } from "./modules/tickets/ticket.routes.js";
import type {
  ClientInvitationRepository,
  ClerkInvitationGateway,
} from "./modules/client-invitations/client-invitation.types.js";
import { PostgresClientInvitationRepository } from "./modules/client-invitations/client-invitation.repository.js";
import { OfficialClerkInvitationGateway } from "./modules/client-invitations/client-invitation.clerk.js";
import { ClientInvitationService } from "./modules/client-invitations/client-invitation.service.js";
import { clientInvitationRoutes } from "./modules/client-invitations/client-invitation.routes.js";
import type { DiagnosticRepository } from "./modules/diagnostic/diagnostic.types.js";
import { PostgresDiagnosticRepository } from "./modules/diagnostic/diagnostic.repository.js";
import { DiagnosticService } from "./modules/diagnostic/diagnostic.service.js";
import { diagnosticRoutes } from "./modules/diagnostic/diagnostic.routes.js";

export interface BuildAppOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: FastifyServerOptions["logger"];
  readonly authenticationProvider?: AuthenticationProvider;
  readonly identityRepository?: IdentityRepository;
  readonly webhookVerifier?: ClerkWebhookVerifier;
  readonly webhookProcessor?: ClerkWebhookProcessor;
  readonly serviceCatalogRepository?: ServiceCatalogRepository;
  readonly serviceNeedRepository?: ServiceNeedRepository;
  readonly leadRepository?: LeadRepository;
  readonly organizationRepository?: OrganizationRepository;
  readonly projectRepository?: ProjectRepository;
  readonly taskRepository?: TaskRepository;
  readonly ticketRepository?: TicketRepository;
  readonly clientInvitationRepository?: ClientInvitationRepository;
  readonly clerkInvitationGateway?: ClerkInvitationGateway;
  readonly diagnosticRepository?: DiagnosticRepository;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadEnv(options.env ?? process.env);
  const serverOptions: FastifyServerOptions = {
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    genReqId: () => randomUUID(),
    logger:
      options.logger ??
      (config.LOG_LEVEL === "silent"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              paths: [...SENSITIVE_LOG_PATHS],
              censor: "[REDACTED]",
            },
          }),
  };

  const app = Fastify(serverOptions);
  const healthService = new HealthService();
  app.decorate("config", config);
  app.decorate("healthService", healthService);

  registerErrorHandler(app);
  await app.register(securityPlugin, { env: config });
  await app.register(databasePlugin, { env: config });
  const identityRepository = options.identityRepository ??
    (app.databasePool === null
      ? { findByClerkUserId: () => Promise.resolve(null) }
      : new PostgresIdentityRepository(app.databasePool));
  const identityService = new IdentityService(identityRepository);
  await app.register(clerkIntegrationPlugin, {
    env: config,
    ...(options.authenticationProvider === undefined ? {} : { provider: options.authenticationProvider }),
  });
  await app.register(authContextPlugin, { identityService });
  await app.register(healthRoutes, { healthService });
  await app.register(identityRoutes, { identityService });

  const shouldRegisterWebhook = config.CLERK_WEBHOOKS_ENABLED ||
    (options.webhookVerifier !== undefined && options.webhookProcessor !== undefined);
  if (shouldRegisterWebhook) {
    if (app.databasePool === null && options.webhookProcessor === undefined) {
      throw new Error("Webhook processing requires a database");
    }
    const verifier = options.webhookVerifier ??
      new OfficialClerkWebhookVerifier(config.CLERK_WEBHOOK_SIGNING_SECRET ?? "");
    const processor = options.webhookProcessor ?? new ClerkWebhookService(app.databasePool!);
    await app.register(clerkWebhookRoutes, { verifier, service: processor });
  }

  const hasPhase4Dependencies = app.databasePool !== null ||
    (
      options.serviceCatalogRepository !== undefined &&
      options.leadRepository !== undefined &&
      options.organizationRepository !== undefined
    );
  if (hasPhase4Dependencies) {
    const authorization = new AuthorizationService();
    const serviceCatalogRepository = options.serviceCatalogRepository ??
      new PostgresServiceCatalogRepository(app.databasePool!);
    const leadRepository = options.leadRepository ?? new PostgresLeadRepository(app.databasePool!);
    const organizationRepository = options.organizationRepository ??
      new PostgresOrganizationRepository(app.databasePool!);

    await app.register(serviceCatalogRoutes, {
      prefix: "/api/v1",
      service: new ServiceCatalogService(serviceCatalogRepository, authorization),
    });
    await app.register(leadRoutes, {
      prefix: "/api/v1",
      service: new LeadService(leadRepository, authorization),
    });
    await app.register(organizationRoutes, {
      prefix: "/api/v1",
      service: new OrganizationService(organizationRepository, authorization),
    });
  }

  const hasServiceNeedDependencies = app.databasePool !== null || options.serviceNeedRepository !== undefined;
  if (hasServiceNeedDependencies) {
    const serviceNeedRepository = options.serviceNeedRepository ?? new PostgresServiceNeedRepository(app.databasePool!);
    await app.register(serviceNeedRoutes, {
      prefix: "/api/v1",
      service: new ServiceNeedService(serviceNeedRepository, new AuthorizationService()),
    });
  }

  const hasDiagnosticDependencies = app.databasePool !== null || options.diagnosticRepository !== undefined;
  if (hasDiagnosticDependencies) {
    const diagnosticRepository = options.diagnosticRepository ?? new PostgresDiagnosticRepository(app.databasePool!);
    await app.register(diagnosticRoutes, {
      prefix: "/api/v1",
      service: new DiagnosticService(diagnosticRepository, new AuthorizationService()),
    });
  }

  const hasClientInvitationDependencies =
    (options.clientInvitationRepository !== undefined && options.clerkInvitationGateway !== undefined) ||
    (app.databasePool !== null && config.CLERK_SECRET_KEY !== undefined);
  if (hasClientInvitationDependencies) {
    const repository = options.clientInvitationRepository ??
      new PostgresClientInvitationRepository(app.databasePool!);
    const clerk = options.clerkInvitationGateway ??
      new OfficialClerkInvitationGateway(config.CLERK_SECRET_KEY!);
    await app.register(clientInvitationRoutes, {
      prefix: "/api/v1",
      service: new ClientInvitationService(
        repository,
        new AuthorizationService(),
        clerk,
        config.CLIENT_APP_URL ?? config.CORS_ORIGINS[0]!,
      ),
    });
  }

  const hasPhase5Dependencies = app.databasePool !== null ||
    (options.projectRepository !== undefined && options.taskRepository !== undefined);
  if (hasPhase5Dependencies) {
    const authorization = new AuthorizationService();
    const projectRepository = options.projectRepository ??
      new PostgresProjectRepository(app.databasePool!);
    const taskRepository = options.taskRepository ?? new PostgresTaskRepository(app.databasePool!);
    await app.register(projectRoutes, {
      prefix: "/api/v1",
      service: new ProjectService(projectRepository, authorization),
    });
    await app.register(taskRoutes, {
      prefix: "/api/v1",
      service: new TaskService(taskRepository, authorization),
    });
  }

  const hasPhase6Dependencies = app.databasePool !== null || options.ticketRepository !== undefined;
  if (hasPhase6Dependencies) {
    const authorization = new AuthorizationService();
    const ticketRepository = options.ticketRepository ?? new PostgresTicketRepository(app.databasePool!);
    await app.register(ticketRoutes, {
      prefix: "/api/v1",
      service: new TicketService(ticketRepository, authorization),
    });
  }

  return app;
}
