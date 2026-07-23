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
  const leadConstraints = physicalConstraints.filter(
    (constraint) =>
      constraint.contype === "c" &&
      constraint.conname === "chk_leads_conversion",
  );
  const leadConversionCheck = {
    count: leadConstraints.length,
    phase: classifyLeadConversionCheck(leadConstraints[0]?.definition),
  };
  const comparisonsMatch = Object.values(comparisons).every(
    (comparison) =>
      comparison.missingInDatabase.length === 0 &&
      comparison.unexpectedInDatabase.length === 0,
  );
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
    leadConversionCheck,
    duplicatePhysicalIndexes,
    validationSchemas,
  };
}
