import { describe, expect, it } from "vitest";
import { evaluateDiagnostic } from "../../src/modules/diagnostic/diagnostic.engine.js";
import type { DiagnosticConfiguration } from "../../src/modules/diagnostic/diagnostic.types.js";

const RULE_SET_ID = "00000000-0000-4000-8000-000000008c00";
const Q1 = "00000000-0000-4000-8000-000000008c01";
const Q2 = "00000000-0000-4000-8000-000000008c02";
const O1 = "00000000-0000-4000-8000-000000008c11";
const O2 = "00000000-0000-4000-8000-000000008c12";
const O3 = "00000000-0000-4000-8000-000000008c13";
const N1 = "00000000-0000-4000-8000-000000008c21";
const N2 = "00000000-0000-4000-8000-000000008c22";
const S1 = "00000000-0000-4000-8000-000000008c31";
const S2 = "00000000-0000-4000-8000-000000008c32";
const now = new Date("2026-08-25T15:00:00.000Z");

function configuration(): DiagnosticConfiguration {
  return {
    ruleSet: {
      id: RULE_SET_ID, version: 3, status: "published", title: "Motor", description: "Determinista",
      publishedAt: now, createdAt: now, updatedAt: now,
      questions: [
        { id: Q1, code: "goal", question: "Objetivo", helpText: null, type: "single_choice", displayOrder: 10, required: true, isActive: true,
          options: [
            { id: O1, code: "first", label: "Primero", description: null, displayOrder: 10, points: [{ needId: N1, points: 4 }] },
            { id: O2, code: "second", label: "Segundo", description: null, displayOrder: 20, points: [{ needId: N2, points: 4 }] },
          ] },
        { id: Q2, code: "details", question: "Detalles", helpText: null, type: "multiple_choice", displayOrder: 20, required: true, isActive: true,
          options: [{ id: O3, code: "both", label: "Integrar", description: null, displayOrder: 10, points: [{ needId: N1, points: 2 }, { needId: N2, points: 3 }] }] },
      ],
    },
    needs: [
      { id: N1, code: "automation", title: "Automatización", shortDescription: "Reducir tareas manuales.", displayOrder: 10 },
      { id: N2, code: "integration", title: "Integración", shortDescription: "Conectar herramientas.", displayOrder: 20 },
    ],
    services: [
      { id: S1, name: "Servicio A", category: "automation", description: "A" },
      { id: S2, name: "Servicio B", category: "development", description: "B" },
    ],
    serviceNeedLinks: [
      { needId: N1, serviceId: S1, weight: 50, isPrimary: false },
      { needId: N2, serviceId: S1, weight: 50, isPrimary: false },
      { needId: N1, serviceId: S2, weight: 50, isPrimary: true },
      { needId: N2, serviceId: S2, weight: 50, isPrimary: true },
    ],
  };
}

describe("diagnostic deterministic engine", () => {
  it("adds option points per need and reuses service link weights", () => {
    const output = evaluateDiagnostic(configuration(), [
      { questionId: Q1, optionIds: [O1] },
      { questionId: Q2, optionIds: [O3] },
    ], now);
    expect(output.needScores).toEqual({ [N1]: 6, [N2]: 3 });
    expect(output.result.primaryNeed?.id).toBe(N1);
    expect(output.result.primaryService?.id).toBe(S2);
    expect(output.result.complementaryServices.map((service) => service.id)).toEqual([S1]);
    expect(output.result.reasons[0]?.explanation).toContain("Primero");
  });

  it("uses display order and then stable identifiers for deterministic need ties", () => {
    const output = evaluateDiagnostic(configuration(), [
      { questionId: Q1, optionIds: [O2] },
      { questionId: Q2, optionIds: [O3] },
    ], now);
    expect(output.needScores).toEqual({ [N1]: 2, [N2]: 7 });
    expect(output.result.primaryNeed?.id).toBe(N2);
    expect(output.result.engineVersion).toBe(3);
    expect(output.result).not.toHaveProperty("serviceScores");
    expect(output.result.disclaimer).toContain("preliminar");
  });
});
