/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- focused HTTP fake. */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticConfiguration, DiagnosticRepository } from "../../src/modules/diagnostic/diagnostic.types.js";
import { buildTestApp } from "../helpers/build-test-app.js";

const RULE = "00000000-0000-4000-8000-000000008c00";
const QUESTION = "00000000-0000-4000-8000-000000008c01";
const OTHER_QUESTION = "00000000-0000-4000-8000-000000008c02";
const OPTION = "00000000-0000-4000-8000-000000008c11";
const OTHER_OPTION = "00000000-0000-4000-8000-000000008c12";
const NEED = "00000000-0000-4000-8000-000000008c21";
const SERVICE = "00000000-0000-4000-8000-000000008c31";
const now = new Date("2026-08-25T15:00:00.000Z");

function config(): DiagnosticConfiguration {
  return {
    ruleSet: { id: RULE, version: 1, status: "published", title: "Orientador", description: "Preguntas", publishedAt: now, createdAt: now, updatedAt: now,
      questions: [
        { id: QUESTION, code: "goal", question: "¿Objetivo?", helpText: null, type: "single_choice", displayOrder: 10, required: true, isActive: true,
          options: [{ id: OPTION, code: "sell", label: "Vender", description: null, displayOrder: 10, points: [{ needId: NEED, points: 5 }] }] },
        { id: OTHER_QUESTION, code: "optional", question: "¿Otro?", helpText: null, type: "multiple_choice", displayOrder: 20, required: false, isActive: true,
          options: [{ id: OTHER_OPTION, code: "other", label: "Otro", description: null, displayOrder: 10, points: [{ needId: NEED, points: 1 }] }] },
      ] },
    needs: [{ id: NEED, code: "sell_online", title: "Vender", shortDescription: "Venta digital", displayOrder: 10 }],
    services: [{ id: SERVICE, name: "Tienda", category: "ecommerce", description: "Comercio" }],
    serviceNeedLinks: [{ needId: NEED, serviceId: SERVICE, weight: 90, isPrimary: true }],
  };
}

function repository(): DiagnosticRepository {
  return {
    getPublishedConfiguration: vi.fn(async () => config()),
    createRun: vi.fn(async (input) => ({ id: "00000000-0000-4000-8000-000000008c99", expiresAt: input.expiresAt, result: input.resultSnapshot })),
    getAdminState: vi.fn(async () => ({ published: config().ruleSet, draft: null })),
    saveDraft: vi.fn(async () => config().ruleSet),
    publishDraft: vi.fn(async () => ({ published: config().ruleSet, draft: null })),
  };
}

describe("Phase 8C diagnostic HTTP", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app !== undefined) await app.close(); app = undefined; });

  it("returns only public questions/options and evaluates on the backend", async () => {
    const repo = repository();
    app = await buildTestApp({}, { diagnosticRepository: repo });
    const definition = await app.inject({ method: "GET", url: "/api/v1/diagnostic" });
    expect(definition.statusCode).toBe(200);
    expect(definition.json().data.questions[0].options[0]).not.toHaveProperty("points");
    const evaluated = await app.inject({ method: "POST", url: "/api/v1/diagnostic/evaluate", payload: {
      ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OPTION] }], initialNeedCode: "sell_online",
    } });
    expect(evaluated.statusCode).toBe(201);
    expect(evaluated.json().data).toMatchObject({ diagnosticId: expect.any(String), primaryService: { id: SERVICE } });
    expect(repo.createRun).toHaveBeenCalledOnce();
  });

  it.each([
    ["option from another question", { ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OTHER_OPTION] }] }],
    ["incomplete required answers", { ruleSetId: RULE, answers: [{ questionId: OTHER_QUESTION, optionIds: [OTHER_OPTION] }] }],
    ["duplicate options", { ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OPTION, OPTION] }] }],
    ["browser points", { ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OPTION], points: 999 }] }],
    ["browser serviceId", { ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OPTION] }], serviceId: SERVICE }],
  ])("rejects %s", async (_name, payload) => {
    const repo = repository();
    app = await buildTestApp({}, { diagnosticRepository: repo });
    expect((await app.inject({ method: "POST", url: "/api/v1/diagnostic/evaluate", payload })).statusCode).toBe(400);
    expect(repo.createRun).not.toHaveBeenCalled();
  });

  it("rejects an old ruleset with 409 and rate limits evaluation", async () => {
    app = await buildTestApp({}, { diagnosticRepository: repository() });
    expect((await app.inject({ method: "POST", url: "/api/v1/diagnostic/evaluate", payload: {
      ruleSetId: "00000000-0000-4000-8000-000000008c88", answers: [{ questionId: QUESTION, optionIds: [OPTION] }],
    } })).statusCode).toBe(409);
    for (let index = 0; index < 9; index += 1) {
      expect((await app.inject({ method: "POST", url: "/api/v1/diagnostic/evaluate", payload: {
        ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OPTION] }],
      } })).statusCode).toBe(201);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/diagnostic/evaluate", payload: {
      ruleSetId: RULE, answers: [{ questionId: QUESTION, optionIds: [OPTION] }],
    } })).statusCode).toBe(429);
  });
});
