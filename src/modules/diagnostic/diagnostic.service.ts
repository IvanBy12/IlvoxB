import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { evaluateDiagnostic } from "./diagnostic.engine.js";
import type {
  DiagnosticAnswerInput,
  DiagnosticDraftInput,
  DiagnosticRepository,
  DiagnosticRuleSetDefinition,
} from "./diagnostic.types.js";

function publicRuleSet(ruleSet: DiagnosticRuleSetDefinition) {
  return {
    id: ruleSet.id,
    version: ruleSet.version,
    title: ruleSet.title,
    description: ruleSet.description,
    questions: ruleSet.questions.map((question) => ({
      id: question.id,
      code: question.code,
      question: question.question,
      helpText: question.helpText,
      type: question.type,
      displayOrder: question.displayOrder,
      required: question.required,
      options: question.options.map((option) => ({
        id: option.id,
        code: option.code,
        label: option.label,
        description: option.description,
        displayOrder: option.displayOrder,
      })),
    })),
  };
}

export class DiagnosticService {
  constructor(
    private readonly repository: DiagnosticRepository,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPublic() {
    const configuration = await this.repository.getPublishedConfiguration();
    if (configuration === null) throw this.notFound("Published diagnostic");
    return publicRuleSet(configuration.ruleSet);
  }

  async evaluate(ruleSetId: string, answers: readonly DiagnosticAnswerInput[], initialNeedCode?: string) {
    const configuration = await this.repository.getPublishedConfiguration();
    if (configuration === null) throw this.notFound("Published diagnostic");
    if (configuration.ruleSet.id !== ruleSetId) {
      throw new AppError({
        code: ErrorCode.Conflict,
        message: "Diagnostic version is no longer current",
        statusCode: 409,
      });
    }
    this.validateAnswers(configuration.ruleSet, answers);
    const completedAt = this.now();
    const initialNeed = initialNeedCode === undefined
      ? undefined
      : configuration.needs.find((need) => need.code === initialNeedCode);
    const output = evaluateDiagnostic(configuration, answers, completedAt);
    const expiresAt = new Date(completedAt.getTime() + 24 * 60 * 60 * 1000);
    const run = await this.repository.createRun({
      ruleSetId,
      initialNeedId: initialNeed?.id ?? null,
      answers: output.result.answers,
      needScores: output.needScores,
      resultSnapshot: output.result,
      completedAt,
      expiresAt,
    });
    return { diagnosticId: run.id, expiresAt: run.expiresAt, ...run.result };
  }

  async getAdmin(actor: ActorContext) {
    this.authorize(actor, "services.read");
    return this.repository.getAdminState();
  }

  async saveDraft(actor: ActorContext, input: DiagnosticDraftInput, audit: AuditContext) {
    this.authorize(actor, "services.manage");
    this.validateDraft(input);
    try {
      return await this.repository.saveDraft({
        title: input.title.trim(),
        description: input.description.trim(),
        questions: input.questions.map((question) => ({
          ...question,
          code: question.code.trim(),
          question: question.question.trim(),
          ...(question.helpText === undefined || question.helpText === null ? {} : { helpText: question.helpText.trim() }),
          options: question.options.map((option) => ({
            ...option,
            code: option.code.trim(),
            label: option.label.trim(),
            ...(option.description === undefined || option.description === null ? {} : { description: option.description.trim() }),
          })),
        })),
      }, audit);
    } catch (error) {
      if ((error as { readonly code?: string }).code === "ILVOX_DIAGNOSTIC_NEED_NOT_FOUND") {
        throw new AppError({ code: ErrorCode.ValidationError, message: "A scoring need does not exist", statusCode: 400 });
      }
      throw error;
    }
  }

  async publish(actor: ActorContext, audit: AuditContext) {
    this.authorize(actor, "services.manage");
    const result = await this.repository.publishDraft(audit);
    if (result === "draft_missing") throw this.notFound("Diagnostic draft");
    if (result === "draft_incomplete") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Every active question and option must have complete scoring rules",
        statusCode: 400,
      });
    }
    return result;
  }

  private validateAnswers(ruleSet: DiagnosticRuleSetDefinition, answers: readonly DiagnosticAnswerInput[]): void {
    const byQuestion = new Map<string, DiagnosticAnswerInput>();
    for (const answer of answers) {
      if (byQuestion.has(answer.questionId)) this.invalid("A question cannot be answered twice");
      if (new Set(answer.optionIds).size !== answer.optionIds.length) this.invalid("An option cannot be selected twice");
      byQuestion.set(answer.questionId, answer);
    }
    const activeQuestions = new Map(ruleSet.questions.filter((question) => question.isActive).map((question) => [question.id, question]));
    for (const answer of answers) {
      const question = activeQuestions.get(answer.questionId);
      if (question === undefined) this.invalid("Answer references a question outside the current diagnostic");
      if (question.type === "single_choice" && answer.optionIds.length !== 1) this.invalid("Single choice questions accept exactly one option");
      const validIds = new Set(question.options.map((option) => option.id));
      if (answer.optionIds.some((id) => !validIds.has(id))) this.invalid("Option does not belong to its question");
    }
    for (const question of activeQuestions.values()) {
      if (question.required && !byQuestion.has(question.id)) this.invalid("Required questions must be answered");
    }
  }

  private validateDraft(input: DiagnosticDraftInput): void {
    const questionCodes = new Set<string>();
    for (const question of input.questions) {
      if (questionCodes.has(question.code)) this.invalid("Question codes must be unique");
      questionCodes.add(question.code);
      const optionCodes = new Set<string>();
      for (const option of question.options) {
        if (optionCodes.has(option.code)) this.invalid("Option codes must be unique within a question");
        optionCodes.add(option.code);
        const needIds = option.points.map((rule) => rule.needId);
        if (new Set(needIds).size !== needIds.length) this.invalid("An option cannot score the same need twice");
      }
    }
  }

  private authorize(actor: ActorContext, action: "services.read" | "services.manage"): void {
    if (!actor.internal) {
      throw new AppError({ code: ErrorCode.Forbidden, message: "Operation is not allowed", statusCode: 403 });
    }
    this.authorization.assertAllowed({ actor, action, resourceType: "diagnostic_rule_set" });
  }

  private invalid(message: string): never {
    throw new AppError({ code: ErrorCode.ValidationError, message, statusCode: 400 });
  }

  private notFound(resource: string): AppError {
    return new AppError({ code: ErrorCode.NotFound, message: `${resource} not found`, statusCode: 404 });
  }
}
