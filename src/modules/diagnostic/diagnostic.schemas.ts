import { Type, type Static } from "@sinclair/typebox";

const Code = Type.String({ pattern: "^[a-z][a-z0-9_]*$", minLength: 1, maxLength: 64 });
const PointRule = Type.Object({
  needId: Type.String({ format: "uuid" }),
  points: Type.Integer({ minimum: 1, maximum: 1000 }),
}, { additionalProperties: false });
const AdminOption = Type.Object({
  code: Code,
  label: Type.String({ minLength: 1, maxLength: 300 }),
  description: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 1000 }), Type.Null()])),
  displayOrder: Type.Integer({ minimum: 0, maximum: 1000 }),
  points: Type.Array(PointRule, { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });
const AdminQuestion = Type.Object({
  code: Code,
  question: Type.String({ minLength: 1, maxLength: 500 }),
  helpText: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 1000 }), Type.Null()])),
  type: Type.Union([Type.Literal("single_choice"), Type.Literal("multiple_choice")]),
  displayOrder: Type.Integer({ minimum: 0, maximum: 1000 }),
  required: Type.Boolean(),
  isActive: Type.Boolean(),
  options: Type.Array(AdminOption, { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });

export const DiagnosticEvaluateBodySchema = Type.Object({
  ruleSetId: Type.String({ format: "uuid" }),
  answers: Type.Array(Type.Object({
    questionId: Type.String({ format: "uuid" }),
    optionIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 20 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 30 }),
  initialNeedCode: Type.Optional(Code),
}, { additionalProperties: false });

export const DiagnosticDraftBodySchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  questions: Type.Array(AdminQuestion, { minItems: 1, maxItems: 30 }),
}, { additionalProperties: false });

export type DiagnosticEvaluateBody = Static<typeof DiagnosticEvaluateBodySchema>;
export type DiagnosticDraftBody = Static<typeof DiagnosticDraftBodySchema>;
