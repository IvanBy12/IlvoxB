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
import type { UserCatalogRepository } from "./modules/users/user-catalog.types.js";
import { PostgresUserCatalogRepository } from "./modules/users/user-catalog.repository.js";
import { UserCatalogService } from "./modules/users/user-catalog.service.js";
import { userCatalogRoutes } from "./modules/users/user-catalog.routes.js";
import type { InternalInvitationRepository } from "./modules/internal-invitations/internal-invitation.types.js";
import { PostgresInternalInvitationRepository } from "./modules/internal-invitations/internal-invitation.repository.js";
import { InternalInvitationService } from "./modules/internal-invitations/internal-invitation.service.js";
import { internalInvitationRoutes } from "./modules/internal-invitations/internal-invitation.routes.js";
import type { FileRepositoryPort } from "./modules/files/file.types.js";
import { FileRepository } from "./modules/files/file.repository.js";
import type { FileStorage } from "./modules/files/file-storage.js";
import { R2FileStorage } from "./modules/files/file-storage.js";
import { FilePolicy } from "./modules/files/file-policy.js";
import { FileService } from "./modules/files/file.service.js";
import { fileRoutes } from "./modules/files/file.routes.js";
import type { EmailProvider } from "./modules/email-notifications/email-provider.js";
import { DisabledEmailProvider } from "./modules/email-notifications/disabled-email.provider.js";
import { ResendEmailProvider } from "./modules/email-notifications/resend-email.provider.js";
import type { EmailNotificationRepository } from "./modules/email-notifications/email-notification.repository.js";
import { PostgresEmailNotificationRepository } from "./modules/email-notifications/email-notification.repository.js";
import { EmailNotificationDispatcher } from "./modules/email-notifications/email-notification.dispatcher.js";

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
  readonly userCatalogRepository?: UserCatalogRepository;
  readonly internalInvitationRepository?: InternalInvitationRepository;
  readonly internalClerkInvitationGateway?: ClerkInvitationGateway;
  readonly fileRepository?: FileRepositoryPort;
  readonly fileStorage?: FileStorage;
  readonly emailProvider?: EmailProvider;
  readonly emailNotificationRepository?: EmailNotificationRepository;
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

  const hasUserCatalogDependencies = app.databasePool !== null || options.userCatalogRepository !== undefined;
  if (hasUserCatalogDependencies) {
    const userCatalogRepository = options.userCatalogRepository ??
      new PostgresUserCatalogRepository(app.databasePool!);
    await app.register(userCatalogRoutes, {
      prefix: "/api/v1",
      service: new UserCatalogService(userCatalogRepository, new AuthorizationService()),
    });
  }

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
    const leadNotificationConfig = config.NOTIFICATION_EMAIL_TO.length === 0
      ? undefined
      : { recipients: config.NOTIFICATION_EMAIL_TO, provider: config.EMAIL_PROVIDER };
    const leadRepository = options.leadRepository ?? new PostgresLeadRepository(
      app.databasePool!,
      leadNotificationConfig,
    );
    const organizationRepository = options.organizationRepository ??
      new PostgresOrganizationRepository(app.databasePool!);
    let notificationDispatcher: EmailNotificationDispatcher | undefined;
    if (app.databasePool !== null && config.EMAIL_FROM !== undefined && config.NOTIFICATION_EMAIL_TO.length > 0) {
      const emailProvider = options.emailProvider ?? (config.EMAIL_PROVIDER === "resend"
        ? new ResendEmailProvider(config.RESEND_API_KEY!)
        : new DisabledEmailProvider());
      notificationDispatcher = new EmailNotificationDispatcher(
        options.emailNotificationRepository ?? new PostgresEmailNotificationRepository(app.databasePool),
        emailProvider,
        { from: config.EMAIL_FROM, frontendAppUrl: config.CLIENT_APP_URL ?? config.CORS_ORIGINS[0]! },
        app.log,
      );
      if (config.EMAIL_PROVIDER === "resend" || options.emailProvider !== undefined) {
        app.addHook("onReady", () => { notificationDispatcher?.start(); });
        app.addHook("onClose", () => { notificationDispatcher?.stop(); });
      }
    }

    await app.register(serviceCatalogRoutes, {
      prefix: "/api/v1",
      service: new ServiceCatalogService(serviceCatalogRepository, authorization),
    });
    await app.register(leadRoutes, {
      prefix: "/api/v1",
      service: new LeadService(leadRepository, authorization, notificationDispatcher),
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

  const hasInternalInvitationDependencies =
    (options.internalInvitationRepository !== undefined && options.internalClerkInvitationGateway !== undefined) ||
    (app.databasePool !== null && config.CLERK_SECRET_KEY !== undefined);
  if (hasInternalInvitationDependencies) {
    const repository = options.internalInvitationRepository ??
      new PostgresInternalInvitationRepository(app.databasePool!);
    const clerk = options.internalClerkInvitationGateway ??
      new OfficialClerkInvitationGateway(config.CLERK_SECRET_KEY!);
    await app.register(internalInvitationRoutes, {
      prefix: "/api/v1",
      service: new InternalInvitationService(
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

  const configuredStorage = options.fileStorage ?? (config.FILE_STORAGE_PROVIDER === "r2"
    ? new R2FileStorage({ endpoint: config.R2_ENDPOINT!, region: config.R2_REGION, bucket: config.R2_BUCKET!,
        accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY! })
    : undefined);
  const hasFileDependencies = configuredStorage !== undefined &&
    (app.databasePool !== null || options.fileRepository !== undefined);
  if (hasFileDependencies) {
    const repository = options.fileRepository ?? new FileRepository(app.databasePool!);
    await app.register(fileRoutes, { prefix: "/api/v1", service: new FileService(repository, configuredStorage,
      new AuthorizationService(), new FilePolicy({ documentBytes: config.FILE_DOCUMENT_MAX_BYTES,
        imageBytes: config.FILE_IMAGE_MAX_BYTES, zipBytes: config.FILE_ZIP_MAX_BYTES }),
      { uploadTtlSeconds: config.FILE_UPLOAD_URL_TTL_SECONDS, downloadTtlSeconds: config.FILE_DOWNLOAD_URL_TTL_SECONDS }) });
  }

  return app;
}
