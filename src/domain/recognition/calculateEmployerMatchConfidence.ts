import type {
  DimensionAssessment,
  EmployerMatchAssessment,
} from "./EmployerMatchAssessment.js";

export function calculateEmployerMatchConfidence(
  assessment: EmployerMatchAssessment,
): number {
  const confidence = calculateCalibratedConfidence(assessment);
  return Number.isFinite(confidence)
    ? Math.min(1, Math.max(0, confidence))
    : 0;
}

function calculateCalibratedConfidence(
  assessment: EmployerMatchAssessment,
): number {
  const identity = assessment.identity.assessment;
  const geography = assessment.geography.assessment;
  const characteristics = assessment.characteristics.assessment;
  const intermediary = assessment.intermediary.assessment;

  // An explicit incompatible employer identity dominates all corroborating context.
  if (identity === "DECISIVE_NEGATIVE") return 0.02;

  // Same explicit employer normally supports automatic matching, except when the
  // structured fingerprint contains a strong internal contradiction.
  if (identity === "VERY_STRONG_POSITIVE") {
    if (isStrongOrDecisiveNegative(characteristics)) return 0.8;
    if (
      isAtLeastMediumPositive(geography) ||
      isAtLeastStrongPositive(characteristics)
    ) {
      return 0.98;
    }
    return 0.95;
  }

  // Other negative identity conclusions remain conservative even if context is
  // positive. These states are not currently emitted by the first comparator,
  // but handling them keeps the calculator total over its domain type.
  if (identity === "STRONG_NEGATIVE") return 0.08;
  if (identity === "MODERATE_NEGATIVE") return 0.12;
  if (identity === "WEAK_NEGATIVE") return 0.16;

  // Strong fingerprint contradictions normally suppress anonymous matches.
  if (characteristics === "DECISIVE_NEGATIVE") return 0.05;
  if (characteristics === "STRONG_NEGATIVE") return 0.2;
  if (characteristics === "MODERATE_NEGATIVE") return 0.35;
  if (characteristics === "WEAK_NEGATIVE") return 0.45;

  // A highly distinctive anonymous fingerprint needs independent geographic
  // corroboration to reach automatic-match territory.
  if (characteristics === "VERY_STRONG_POSITIVE") {
    return isAtLeastMediumPositive(geography) ? 0.91 : 0.84;
  }

  if (characteristics === "STRONG_POSITIVE") {
    if (isAtLeastMediumPositive(geography)) return 0.8;
    if (geography === "WEAK_POSITIVE") return 0.72;
    return 0.67;
  }

  if (characteristics === "MEDIUM_POSITIVE") {
    if (isAtLeastMediumPositive(geography)) return 0.62;
    if (geography === "WEAK_POSITIVE") return 0.52;
    return 0.45;
  }

  // Weaker explicit identity evidence is useful but cannot reach automatic match.
  if (identity === "STRONG_POSITIVE") return 0.85;
  if (identity === "MEDIUM_POSITIVE") return 0.7;
  if (identity === "WEAK_POSITIVE") return 0.55;

  // Geography and intermediary context alone are deliberately low-confidence.
  if (isAtLeastMediumPositive(geography)) {
    return intermediary === "WEAK_POSITIVE" ? 0.48 : 0.42;
  }
  if (geography === "WEAK_POSITIVE") {
    return intermediary === "WEAK_POSITIVE" ? 0.3 : 0.24;
  }
  if (characteristics === "WEAK_POSITIVE") return 0.35;
  if (intermediary === "WEAK_POSITIVE") return 0.18;

  return 0.1;
}

function isStrongOrDecisiveNegative(value: DimensionAssessment): boolean {
  return value === "STRONG_NEGATIVE" || value === "DECISIVE_NEGATIVE";
}

function isAtLeastMediumPositive(value: DimensionAssessment): boolean {
  return (
    value === "MEDIUM_POSITIVE" ||
    value === "STRONG_POSITIVE" ||
    value === "VERY_STRONG_POSITIVE"
  );
}

function isAtLeastStrongPositive(value: DimensionAssessment): boolean {
  return value === "STRONG_POSITIVE" || value === "VERY_STRONG_POSITIVE";
}
