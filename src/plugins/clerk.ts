import { clerkPlugin, getAuth, type ClerkFastifyOptions } from "@clerk/fastify";
import type { FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import type { AppEnv } from "../config/env.js";

export interface VerifiedExternalIdentity { readonly clerkUserId: string; }

export interface AuthenticationProvider {
  authenticate(request: FastifyRequest): Promise<VerifiedExternalIdentity | null>;
}

class DisabledAuthenticationProvider implements AuthenticationProvider {
  authenticate(): Promise<null> { return Promise.resolve(null); }
}

class OfficialClerkAuthenticationProvider implements AuthenticationProvider {
  authenticate(request: FastifyRequest): Promise<VerifiedExternalIdentity | null> {
    const auth = getAuth(request, { acceptsToken: "session_token" });
    return Promise.resolve(auth.isAuthenticated && auth.userId !== undefined && auth.userId !== null
      ? { clerkUserId: auth.userId }
      : null);
  }
}

export interface ClerkIntegrationPluginOptions {
  readonly env: AppEnv;
  readonly provider?: AuthenticationProvider;
}

export const clerkIntegrationPlugin = fastifyPlugin<ClerkIntegrationPluginOptions>(async (app, options) => {
  if (options.provider !== undefined) {
    app.decorate("authenticationProvider", options.provider);
    return;
  }
  if (!options.env.CLERK_AUTH_ENABLED) {
    app.decorate("authenticationProvider", new DisabledAuthenticationProvider());
    return;
  }
  const publishableKey = options.env.CLERK_PUBLISHABLE_KEY;
  const secretKey = options.env.CLERK_SECRET_KEY;
  if (publishableKey === undefined || secretKey === undefined) {
    throw new Error("Clerk authentication configuration is incomplete");
  }
  const clerkOptions: ClerkFastifyOptions & {
    readonly authorizedParties: string[];
    readonly audience?: string[];
  } = {
    publishableKey,
    secretKey,
    authorizedParties: [...options.env.CLERK_AUTHORIZED_PARTIES],
    ...(options.env.CLERK_AUDIENCE.length === 0 ? {} : { audience: [...options.env.CLERK_AUDIENCE] }),
    hookName: "onRequest",
  };
  await app.register(clerkPlugin, clerkOptions);
  app.decorate("authenticationProvider", new OfficialClerkAuthenticationProvider());
}, { name: "ilvox-clerk" });
