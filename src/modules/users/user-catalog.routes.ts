import type { FastifyPluginCallback } from "fastify";
import { successResponse } from "../../common/http/api-response.js";
import {
  EligibleUserQuerySchema,
  EligibleUserResponseSchema,
  UserCatalogDetailResponseSchema,
  UserCatalogListQuerySchema,
  UserCatalogListResponseSchema,
  UserIdParamsSchema,
  type EligibleUserHttpQuery,
  type UserCatalogListQuery,
  type UserIdParams,
} from "./user-catalog.schemas.js";
import type { UserCatalogService } from "./user-catalog.service.js";
import type { EligibleUserPurpose, UserCatalogListInput, UserCatalogType } from "./user-catalog.types.js";
import type { LocalUserStatus } from "../../common/auth/authorization.types.js";

export interface UserCatalogRoutesOptions { readonly service: UserCatalogService; }

export const userCatalogRoutes: FastifyPluginCallback<UserCatalogRoutesOptions> = (app, options, done) => {
  app.get<{ Querystring: EligibleUserHttpQuery }>("/users/eligible", {
    preHandler: app.requireActor,
    schema: { querystring: EligibleUserQuerySchema, response: { 200: EligibleUserResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.eligible(request.actor, {
      ...request.query,
      purpose: request.query.purpose as EligibleUserPurpose,
      ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
    }));
  });

  app.get<{ Querystring: UserCatalogListQuery }>("/users", {
    preHandler: app.requireActor,
    schema: { querystring: UserCatalogListQuerySchema, response: { 200: UserCatalogListResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.list(request.actor, {
      page: request.query.page ?? 1,
      pageSize: request.query.pageSize ?? 20,
      sortBy: (request.query.sortBy ?? "createdAt") as UserCatalogListInput["sortBy"],
      sortDirection: (request.query.sortDirection ?? "desc") as UserCatalogListInput["sortDirection"],
      ...(request.query.search === undefined ? {} : { search: request.query.search.trim() }),
      ...(request.query.status === undefined ? {} : { status: request.query.status as LocalUserStatus }),
      ...(request.query.type === undefined ? {} : { type: request.query.type as UserCatalogType }),
      ...(request.query.role === undefined ? {} : { role: request.query.role.trim() }),
    }));
  });

  app.get<{ Params: UserIdParams }>("/users/:userId", {
    preHandler: app.requireActor,
    schema: { params: UserIdParamsSchema, response: { 200: UserCatalogDetailResponseSchema } },
  }, async (request) => {
    if (request.actor === null) throw new Error("Authenticated actor was not constructed");
    return successResponse(await options.service.get(request.actor, request.params.userId));
  });
  done();
};
