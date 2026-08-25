import type { AuditContext } from "../../common/audit/audit.js";

export type DiagnosticQuestionType = "single_choice" | "multiple_choice";
export type DiagnosticRuleSetStatus = "draft" | "published" | "archived";

export interface DiagnosticPointRule {
  readonly needId: string;
  readonly points: number;
}

export interface DiagnosticOptionDefinition {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly description: string | null;
  readonly displayOrder: number;
  readonly points: readonly DiagnosticPointRule[];
}

export interface DiagnosticQuestionDefinition {
  readonly id: string;
  readonly code: string;
  readonly question: string;
  readonly helpText: string | null;
  readonly type: DiagnosticQuestionType;
  readonly displayOrder: number;
  readonly required: boolean;
  readonly isActive: boolean;
  readonly options: readonly DiagnosticOptionDefinition[];
}

export interface DiagnosticRuleSetDefinition {
  readonly id: string;
  readonly version: number;
  readonly status: DiagnosticRuleSetStatus;
  readonly title: string;
  readonly description: string;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly questions: readonly DiagnosticQuestionDefinition[];
}

export interface DiagnosticNeedDefinition {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly displayOrder: number;
}

export interface DiagnosticServiceDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
}

export interface DiagnosticServiceNeedLinkDefinition {
  readonly needId: string;
  readonly serviceId: string;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export interface DiagnosticConfiguration {
  readonly ruleSet: DiagnosticRuleSetDefinition;
  readonly needs: readonly DiagnosticNeedDefinition[];
  readonly services: readonly DiagnosticServiceDefinition[];
  readonly serviceNeedLinks: readonly DiagnosticServiceNeedLinkDefinition[];
}

export interface DiagnosticAnswerInput {
  readonly questionId: string;
  readonly optionIds: readonly string[];
}

export interface DiagnosticEvaluationInput {
  readonly ruleSetId: string;
  readonly answers: readonly DiagnosticAnswerInput[];
  readonly initialNeedCode?: string;
}

export interface DiagnosticNeedResult {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
}

export interface DiagnosticServiceResult {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
}

export interface DiagnosticReason {
  readonly need: string;
  readonly explanation: string;
}

export interface DiagnosticResultSnapshot {
  readonly engineVersion: number;
  readonly ruleSetId: string;
  readonly ruleSetTitle: string;
  readonly completedAt: string;
  readonly answers: readonly {
    readonly questionId: string;
    readonly question: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
  }[];
  readonly primaryNeed: DiagnosticNeedResult | null;
  readonly secondaryNeeds: readonly DiagnosticNeedResult[];
  readonly primaryService: DiagnosticServiceResult | null;
  readonly complementaryServices: readonly DiagnosticServiceResult[];
  readonly reasons: readonly DiagnosticReason[];
  readonly summary: string;
  readonly disclaimer: string;
}

export interface DiagnosticEngineOutput {
  readonly needScores: Readonly<Record<string, number>>;
  readonly result: DiagnosticResultSnapshot;
}

export interface DiagnosticRunCreate {
  readonly ruleSetId: string;
  readonly initialNeedId: string | null;
  readonly answers: DiagnosticResultSnapshot["answers"];
  readonly needScores: Readonly<Record<string, number>>;
  readonly resultSnapshot: DiagnosticResultSnapshot;
  readonly completedAt: Date;
  readonly expiresAt: Date;
}

export interface DiagnosticRunResult {
  readonly id: string;
  readonly expiresAt: Date;
  readonly result: DiagnosticResultSnapshot;
}

export interface DiagnosticAdminQuestionInput {
  readonly code: string;
  readonly question: string;
  readonly helpText?: string | null;
  readonly type: DiagnosticQuestionType;
  readonly displayOrder: number;
  readonly required: boolean;
  readonly isActive: boolean;
  readonly options: readonly {
    readonly code: string;
    readonly label: string;
    readonly description?: string | null;
    readonly displayOrder: number;
    readonly points: readonly DiagnosticPointRule[];
  }[];
}

export interface DiagnosticDraftInput {
  readonly title: string;
  readonly description: string;
  readonly questions: readonly DiagnosticAdminQuestionInput[];
}

export interface DiagnosticAdminState {
  readonly published: DiagnosticRuleSetDefinition | null;
  readonly draft: DiagnosticRuleSetDefinition | null;
}

export interface DiagnosticRepository {
  getPublishedConfiguration(): Promise<DiagnosticConfiguration | null>;
  createRun(input: DiagnosticRunCreate): Promise<DiagnosticRunResult>;
  getAdminState(): Promise<DiagnosticAdminState>;
  saveDraft(input: DiagnosticDraftInput, audit: AuditContext): Promise<DiagnosticRuleSetDefinition>;
  publishDraft(audit: AuditContext): Promise<DiagnosticAdminState | "draft_missing" | "draft_incomplete">;
}
