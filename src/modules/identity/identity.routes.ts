import type { FastifyPluginCallback } from "fastify";
import { successResponse } from "../../common/http/api-response.js";
import { MeResponseSchema, type MeResponse } from "./identity.schemas.js";
import type { IdentityService } from "./identity.service.js";

export interface IdentityRoutesOptions { readonly identityService: IdentityService; }

export const identityRoutes: FastifyPluginCallback<IdentityRoutesOptions> = (app, options, done) => {
  app.get<{ Reply: MeResponse }>("/me", {
    preHandler: app.requireActor,
    schema: { response: { 200: MeResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    const data = await options.identityService.getMe(request.actor.clerkUserId);
    return successResponse(data);
  });
  done();
};
