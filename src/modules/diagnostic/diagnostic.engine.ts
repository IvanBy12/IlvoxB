import type {
  DiagnosticAnswerInput,
  DiagnosticConfiguration,
  DiagnosticEngineOutput,
  DiagnosticNeedDefinition,
  DiagnosticResultSnapshot,
  DiagnosticServiceDefinition,
} from "./diagnostic.types.js";

const DISCLAIMER = "Esta orientación es preliminar y no reemplaza un diagnóstico técnico realizado por el equipo de ILVOX.";

function needResult(need: DiagnosticNeedDefinition) {
  return { id: need.id, code: need.code, title: need.title, description: need.shortDescription };
}

function serviceResult(service: DiagnosticServiceDefinition) {
  return { id: service.id, name: service.name, category: service.category, description: service.description };
}

/** Única función de autoridad para puntuar respuestas y recomendar servicios. */
export function evaluateDiagnostic(
  configuration: DiagnosticConfiguration,
  answers: readonly DiagnosticAnswerInput[],
  completedAt: Date,
): DiagnosticEngineOutput {
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.optionIds]));
  const needScores = new Map<string, number>();
  const answerSnapshot: DiagnosticResultSnapshot["answers"][number][] = [];

  for (const question of configuration.ruleSet.questions) {
    const selectedIds = answerByQuestion.get(question.id) ?? [];
    const selected = question.options.filter((option) => selectedIds.includes(option.id));
    answerSnapshot.push({
      questionId: question.id,
      question: question.question,
      options: selected.map((option) => ({ id: option.id, label: option.label })),
    });
    for (const option of selected) {
      for (const pointRule of option.points) {
        needScores.set(pointRule.needId, (needScores.get(pointRule.needId) ?? 0) + pointRule.points);
      }
    }
  }

  const rankedNeeds = configuration.needs
    .filter((need) => (needScores.get(need.id) ?? 0) > 0)
    .sort((left, right) =>
      (needScores.get(right.id) ?? 0) - (needScores.get(left.id) ?? 0) ||
      left.displayOrder - right.displayOrder || left.title.localeCompare(right.title, "es") || left.id.localeCompare(right.id));
  const primaryNeed = rankedNeeds[0] ?? null;
  const secondaryNeeds = rankedNeeds.slice(1, 4);

  const serviceScores = new Map<string, { score: number; primaryTie: boolean }>();
  for (const link of configuration.serviceNeedLinks) {
    const needScore = needScores.get(link.needId) ?? 0;
    if (needScore === 0) continue;
    const current = serviceScores.get(link.serviceId) ?? { score: 0, primaryTie: false };
    serviceScores.set(link.serviceId, {
      score: current.score + needScore * link.weight,
      primaryTie: current.primaryTie || link.isPrimary,
    });
  }
  const rankedServices = configuration.services
    .filter((service) => (serviceScores.get(service.id)?.score ?? 0) > 0)
    .sort((left, right) => {
      const leftScore = serviceScores.get(left.id)!;
      const rightScore = serviceScores.get(right.id)!;
      return rightScore.score - leftScore.score || Number(rightScore.primaryTie) - Number(leftScore.primaryTie) ||
        left.name.localeCompare(right.name, "es") || left.id.localeCompare(right.id);
    });
  const primaryService = rankedServices[0] ?? null;

  const reasons = rankedNeeds.slice(0, 3).map((need) => {
    const labels = configuration.ruleSet.questions.flatMap((question) => {
      const selectedIds = answerByQuestion.get(question.id) ?? [];
      return question.options
        .filter((option) => selectedIds.includes(option.id) && option.points.some((rule) => rule.needId === need.id))
        .map((option) => option.label);
    });
    const answerContext = [...new Set(labels)].slice(0, 2).join(" y ");
    return {
      need: need.title,
      explanation: answerContext.length > 0
        ? `Tus respuestas “${answerContext}” señalan que ${need.shortDescription.toLocaleLowerCase("es")}`
        : need.shortDescription,
    };
  });
  const summary = primaryService === null
    ? "Tus respuestas requieren una revisión humana para definir una solución concreta."
    : `La orientación inicial sugiere ${primaryService.name} para atender principalmente ${primaryNeed?.title.toLocaleLowerCase("es") ?? "tu reto"}.`;

  return {
    needScores: Object.fromEntries([...needScores.entries()].sort(([left], [right]) => left.localeCompare(right))),
    result: {
      engineVersion: configuration.ruleSet.version,
      ruleSetId: configuration.ruleSet.id,
      ruleSetTitle: configuration.ruleSet.title,
      completedAt: completedAt.toISOString(),
      answers: answerSnapshot,
      primaryNeed: primaryNeed === null ? null : needResult(primaryNeed),
      secondaryNeeds: secondaryNeeds.map(needResult),
      primaryService: primaryService === null ? null : serviceResult(primaryService),
      complementaryServices: rankedServices.slice(1, 4).map(serviceResult),
      reasons,
      summary,
      disclaimer: DISCLAIMER,
    },
  };
}
