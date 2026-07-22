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

export interface BuildAppOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: FastifyServerOptions["logger"];
  readonly authenticationProvider?: AuthenticationProvider;
  readonly identityRepository?: IdentityRepository;
  readonly webhookVerifier?: ClerkWebhookVerifier;
  readonly webhookProcessor?: ClerkWebhookProcessor;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadEnv(options.env ?? process.env);
  const serverOptions: FastifyServerOptions = {
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
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

  return app;
}
