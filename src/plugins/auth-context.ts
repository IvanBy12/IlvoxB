import type { FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { AppError } from "../common/errors/app-error.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import type { IdentityService } from "../modules/identity/identity.service.js";

export interface AuthContextPluginOptions { readonly identityService: IdentityService; }

export const authContextPlugin = fastifyPlugin<AuthContextPluginOptions>((app, options, done) => {
  app.decorateRequest("actor", null);
  app.decorate("requireActor", async (request: FastifyRequest) => {
    const external = await app.authenticationProvider.authenticate(request);
    if (external === null) {
      throw new AppError({
        code: ErrorCode.Unauthenticated,
        message: "Authentication required",
        statusCode: 401,
      });
    }
    request.actor = await options.identityService.requireActor(external.clerkUserId);
  });
  done();
}, { name: "ilvox-auth-context", dependencies: ["ilvox-clerk"] });
