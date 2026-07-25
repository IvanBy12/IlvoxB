const CONSTRAINT_TYPES = {
  checks: "c",
  foreignKeys: "f",
  uniqueConstraints: "u",
};

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort((left, right) => left.localeCompare(right));
}

function matches(sql, expression) {
  return [...sql.matchAll(expression)].map((match) => match[1]);
}

export function extractExportedConstraintNames(sql) {
  const raw = {
    checks: matches(sql, /CONSTRAINT "([^"]+)" CHECK/g),
    foreignKeys: matches(sql, /ADD CONSTRAINT "([^"]+)"\s+FOREIGN KEY/g),
    uniqueConstraints: matches(sql, /CONSTRAINT "([^"]+)" UNIQUE\(/g),
  };
  return {
    checks: sortedUnique(raw.checks),
    foreignKeys: sortedUnique(raw.foreignKeys),
    uniqueConstraints: sortedUnique(raw.uniqueConstraints),
    duplicateNames: sortedUnique(Object.values(raw).flatMap(duplicates)),
  };
}

export function compareConstraintNames(actual, expected) {
  const actualNames = sortedUnique(actual);
  const expectedNames = sortedUnique(expected);
  return {
    actual: actualNames.length,
    expected: expectedNames.length,
    missingInDatabase: expectedNames.filter((name) => !actualNames.includes(name)),
    unexpectedInDatabase: actualNames.filter((name) => !expectedNames.includes(name)),
  };
}

export function classifyLeadConversionCheck(definition) {
  if (typeof definition !== "string") return "missing";
  const normalized = definition
    .toLowerCase()
    .replaceAll(/[()"\s]+/g, "");
  const convertedAtRequired = normalized.includes("converted_atisnotnull");
  const nonConvertedFieldsNull =
    normalized.includes("converted_organization_idisnull") &&
    normalized.includes("converted_atisnull");
  if (!convertedAtRequired || !nonConvertedFieldsNull) return "unexpected";
  if (
    normalized.includes("converted_organization_idisnotnull")
  ) {
    return "pre_phase45";
  }
  return "phase45";
}

export function buildConstraintAudit({
  exportedSql,
  physicalConstraints,
  duplicatePhysicalIndexes,
  validationSchemas,
  allowedPendingConstraints = {},
  phase5ClosureArtifacts,
}) {
  const expected = extractExportedConstraintNames(exportedSql);
  const actualByType = Object.fromEntries(
    Object.entries(CONSTRAINT_TYPES).map(([key, type]) => [
      key,
      physicalConstraints.filter((constraint) => constraint.contype === type)
        .map((constraint) => constraint.conname),
    ]),
  );
  const comparisons = Object.fromEntries(
    Object.keys(CONSTRAINT_TYPES).map((key) => [
      key,
      compareConstraintNames(actualByType[key], expected[key]),
    ]),
  );
  const pendingByType = Object.fromEntries(
    Object.keys(CONSTRAINT_TYPES).map((key) => [
      key,
      sortedUnique(allowedPendingConstraints[key] ?? []),
    ]),
  );
  const pendingStateByType = Object.fromEntries(
    Object.keys(CONSTRAINT_TYPES).map((key) => {
      const comparison = comparisons[key];
      const allowed = pendingByType[key];
      const fullyApplied =
        comparison.missingInDatabase.length === 0 &&
        comparison.unexpectedInDatabase.length === 0;
      const fullyPending =
        allowed.length > 0 &&
        comparison.unexpectedInDatabase.length === 0 &&
        comparison.missingInDatabase.length === allowed.length &&
        comparison.missingInDatabase.every((name, index) => name === allowed[index]);
      return [key, fullyApplied ? "applied" : fullyPending ? "pending" : "drift"];
    }),
  );
  const pendingStates = Object.values(pendingStateByType);
  const pendingMode =
    pendingStates.every((state) => state === "applied")
      ? "applied"
      : pendingStates.every((state, index) =>
          pendingByType[Object.keys(CONSTRAINT_TYPES)[index]].length === 0
            ? state === "applied"
            : state === "pending",
        )
        ? "phase5_closure_pending"
        : "drift";
  const leadConstraints = physicalConstraints.filter(
    (constraint) =>
      constraint.contype === "c" &&
      constraint.conname === "chk_leads_conversion",
  );
  const leadConversionCheck = {
    count: leadConstraints.length,
    phase: classifyLeadConversionCheck(leadConstraints[0]?.definition),
  };
  const phase5ArtifactMode =
    phase5ClosureArtifacts === undefined
      ? "not_checked"
      : phase5ClosureArtifacts.columns === 0 && phase5ClosureArtifacts.indexes === 0
        ? "pending"
        : phase5ClosureArtifacts.columns === 4 && phase5ClosureArtifacts.indexes === 2
          ? "applied"
          : "drift";
  const phase5StateMatches =
    phase5ArtifactMode === "not_checked" ||
    (pendingMode === "phase5_closure_pending" && phase5ArtifactMode === "pending") ||
    (pendingMode === "applied" && phase5ArtifactMode === "applied");
  const comparisonsMatch = pendingMode !== "drift" && phase5StateMatches;
  const ok =
    comparisonsMatch &&
    expected.duplicateNames.length === 0 &&
    duplicatePhysicalIndexes.length === 0 &&
    validationSchemas === 0 &&
    leadConversionCheck.count === 1 &&
    ["pre_phase45", "phase45"].includes(leadConversionCheck.phase);

  return {
    ok,
    expectedFromDrizzle: {
      checks: expected.checks.length,
      foreignKeys: expected.foreignKeys.length,
      uniqueConstraints: expected.uniqueConstraints.length,
      duplicateNames: expected.duplicateNames,
    },
    ...comparisons,
    pendingMode,
    pendingStateByType,
    phase5ClosureArtifacts: phase5ClosureArtifacts === undefined
      ? { mode: phase5ArtifactMode }
      : { ...phase5ClosureArtifacts, mode: phase5ArtifactMode },
    leadConversionCheck,
    duplicatePhysicalIndexes,
    validationSchemas,
  };
}
