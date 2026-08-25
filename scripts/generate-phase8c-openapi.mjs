import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("docs", "openapi.json");
const document = JSON.parse(await readFile(target, "utf8"));
document.info.version = "0.8.2";
document.info.description = "Fase 8C: simulador diagnóstico determinista y versionado. Las respuestas puntúan necesidades y las necesidades puntúan servicios mediante las relaciones públicas/activas de 8B. Sin IA.";
document.tags = [
  ...document.tags.filter((tag) => tag.name !== "Diagnostic"),
  { name: "Diagnostic" },
];

const response = (name) => ({ $ref: `#/components/responses/${name}` });
const success = { "200": response("Success"), "400": response("ValidationError"), "404": response("NotFound"), "429": response("RateLimited") };
const secured = (permission) => ({ security: [{ clerkSession: [] }], "x-permission": permission });
const body = (schema) => ({ required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } } });

document.paths["/diagnostic"] = {
  get: {
    tags: ["Diagnostic"], summary: "Get the currently published diagnostic questionnaire",
    description: "Returns only the published ruleset, active questions and options. Scoring rules and points are never exposed.",
    security: [], "x-rate-limit": "30 per minute", responses: success,
  },
};
document.paths["/diagnostic/evaluate"] = {
  post: {
    tags: ["Diagnostic"], summary: "Evaluate and snapshot a diagnostic",
    description: "The server validates the current ruleset and answers, scores needs, reuses current public/active service_need_links, stores an immutable snapshot and returns no internal scores.",
    security: [], "x-rate-limit": "10 per minute", requestBody: body("DiagnosticEvaluation"),
    responses: { "201": response("Success"), "400": response("ValidationError"), "404": response("NotFound"), "409": response("Conflict"), "429": response("RateLimited") },
  },
};
document.paths["/leads/{leadId}/diagnostic"] = {
  get: {
    tags: ["Leads", "Diagnostic"], summary: "Get the immutable diagnostic snapshot associated with an authorized lead",
    description: "Uses the same SQL scope as the lead and never recalculates the historical result.",
    ...secured("leads.read"), "x-scope": "Identical SQL scope to lead detail; out-of-scope and absent diagnostics return 404",
    parameters: [{ name: "leadId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
    responses: { "200": response("Success"), "400": response("ValidationError"), "401": response("Unauthenticated"), "403": response("Forbidden"), "404": response("NotFound") },
  },
};
document.paths["/admin/diagnostic"] = {
  get: {
    tags: ["Diagnostic"], summary: "Get published and current draft diagnostic versions", ...secured("services.read"),
    responses: { "200": response("Success"), "401": response("Unauthenticated"), "403": response("Forbidden") },
  },
};
document.paths["/admin/diagnostic/draft"] = {
  put: {
    tags: ["Diagnostic"], summary: "Replace the editable draft configuration transactionally", ...secured("services.manage"),
    description: "Published versions are immutable. Option rules point only to service needs, never directly to services.",
    requestBody: body("DiagnosticDraft"),
    responses: { "200": response("Success"), "400": response("ValidationError"), "401": response("Unauthenticated"), "403": response("Forbidden"), "409": response("Conflict") },
  },
};
document.paths["/admin/diagnostic/publish"] = {
  post: {
    tags: ["Diagnostic"], summary: "Transactionally publish the draft and create the next editable version", ...secured("services.manage"),
    description: "Archives the previous published ruleset, publishes the complete draft and clones a new draft in one transaction.",
    responses: { "200": response("Success"), "400": response("ValidationError"), "401": response("Unauthenticated"), "403": response("Forbidden"), "404": response("NotFound"), "409": response("Conflict") },
  },
};

Object.assign(document.components.schemas, {
  DiagnosticAnswer: {
    type: "object", additionalProperties: false, required: ["questionId", "optionIds"],
    properties: {
      questionId: { type: "string", format: "uuid" },
      optionIds: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", format: "uuid" } },
    },
  },
  DiagnosticEvaluation: {
    type: "object", additionalProperties: false, required: ["ruleSetId", "answers"],
    properties: {
      ruleSetId: { type: "string", format: "uuid" },
      answers: { type: "array", minItems: 1, maxItems: 30, items: { $ref: "#/components/schemas/DiagnosticAnswer" } },
      initialNeedCode: { type: "string", pattern: "^[a-z][a-z0-9_]*$", maxLength: 64 },
    },
  },
  DiagnosticPointRule: {
    type: "object", additionalProperties: false, required: ["needId", "points"],
    properties: { needId: { type: "string", format: "uuid" }, points: { type: "integer", minimum: 1, maximum: 1000 } },
  },
  DiagnosticDraft: {
    type: "object", additionalProperties: false, required: ["title", "description", "questions"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", minLength: 1, maxLength: 2000 },
      questions: { type: "array", minItems: 1, maxItems: 30, items: {
        type: "object", additionalProperties: false,
        required: ["code", "question", "type", "displayOrder", "required", "isActive", "options"],
        properties: {
          code: { type: "string", pattern: "^[a-z][a-z0-9_]*$", maxLength: 64 }, question: { type: "string", maxLength: 500 },
          helpText: { type: ["string", "null"], maxLength: 1000 }, type: { type: "string", enum: ["single_choice", "multiple_choice"] },
          displayOrder: { type: "integer", minimum: 0 }, required: { type: "boolean" }, isActive: { type: "boolean" },
          options: { type: "array", minItems: 1, maxItems: 20, items: {
            type: "object", additionalProperties: false, required: ["code", "label", "displayOrder", "points"],
            properties: {
              code: { type: "string", pattern: "^[a-z][a-z0-9_]*$", maxLength: 64 }, label: { type: "string", maxLength: 300 },
              description: { type: ["string", "null"], maxLength: 1000 }, displayOrder: { type: "integer", minimum: 0 },
              points: { type: "array", minItems: 1, maxItems: 20, items: { $ref: "#/components/schemas/DiagnosticPointRule" } },
            },
          } },
        },
      } },
    },
  },
});

const publicLead = document.components.schemas.PublicLeadCreate ?? document.components.schemas.PublicLeadInput;
if (publicLead?.properties !== undefined) {
  publicLead.properties.diagnosticId = { type: "string", format: "uuid", description: "Accepted only when source is diagnostic." };
}

await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version: document.info.version, diagnosticPaths: 6 }));
