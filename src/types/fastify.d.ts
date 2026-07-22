import "fastify";
import type { AppEnv } from "../config/env.js";
import type { Database } from "../db/client.js";
import type { HealthService } from "../modules/health/health.service.js";
import type { Pool } from "pg";
import type { ActorContext } from "../common/auth/authorization.types.js";
import type { AuthenticationProvider } from "../plugins/clerk.js";

declare module "fastify" {
  interface FastifyInstance {
    readonly config: AppEnv;
    readonly database: Database | null;
    readonly databasePool: Pool | null;
    readonly healthService: HealthService;
    readonly authenticationProvider: AuthenticationProvider;
    readonly requireActor: (request: FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    actor: ActorContext | null;
  }
}
