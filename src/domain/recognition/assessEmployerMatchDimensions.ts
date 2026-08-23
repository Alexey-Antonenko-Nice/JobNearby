import type {
  ContradictionStrength,
  EmployerEvidenceComparison,
  EmployerMatchContradiction,
  EmployerMatchSignal,
  MatchSignalStrength,
} from "./EmployerEvidenceComparison.js";
import type {
  DimensionAssessment,
  EmployerMatchAssessment,
  EmployerMatchDimensionAssessment,
} from "./EmployerMatchAssessment.js";

export function assessEmployerMatchDimensions(
  comparison: EmployerEvidenceComparison,
): EmployerMatchAssessment {
  const identitySignals = comparison.positiveSignals.filter(
    ({ kind }) => kind === "EMPLOYER_IDENTITY",
  );
  const identityContradictions = comparison.contradictions.filter(
    ({ kind }) => kind === "EMPLOYER_IDENTITY",
  );
  const geographySignals = comparison.positiveSignals.filter(
    ({ kind }) => kind === "LOCATION",
  );
  const characteristicSignals = comparison.positiveSignals.filter(
    ({ kind }) => kind === "CHARACTERISTIC",
  );
  const characteristicContradictions = comparison.contradictions.filter(
    ({ kind }) => kind === "CHARACTERISTIC",
  );
  const intermediarySignals = comparison.positiveSignals.filter(
    ({ kind }) => kind === "INTERMEDIARY_CONTEXT",
  );

  return {
    identity: assessDimension(identitySignals, identityContradictions),
    geography: assessDimension(geographySignals, []),
    characteristics: assessCharacteristicDimension(
      characteristicSignals,
      characteristicContradictions,
    ),
    intermediary: {
      assessment:
        intermediarySignals.length === 0 ? "UNKNOWN" : "WEAK_POSITIVE",
      supportingSignals: intermediarySignals,
      contradictions: [],
    },
  };
}

function assessCharacteristicDimension(
  signals: readonly EmployerMatchSignal[],
  contradictions: readonly EmployerMatchContradiction[],
): EmployerMatchDimensionAssessment {
  const uniqueSignals = uniqueCharacteristicSignals(signals);
  const uniqueContradictions = uniqueCharacteristicContradictions(contradictions);
  let strongestPositive = strongestSignal(uniqueSignals);
  const reinforcingStrongSignals = uniqueSignals.filter(
    ({ strength }) => strength === "STRONG" || strength === "VERY_STRONG",
  );
  if (
    strongestPositive === "STRONG" &&
    reinforcingStrongSignals.length >= 2
  ) {
    strongestPositive = "VERY_STRONG";
  }

  return {
    assessment: resolveAssessment(
      strongestPositive,
      strongestContradiction(uniqueContradictions),
      true,
    ),
    supportingSignals: signals,
    contradictions,
  };
}

function assessDimension(
  signals: readonly EmployerMatchSignal[],
  contradictions: readonly EmployerMatchContradiction[],
): EmployerMatchDimensionAssessment {
  return {
    assessment: resolveAssessment(
      strongestSignal(signals),
      strongestContradiction(contradictions),
      false,
    ),
    supportingSignals: signals,
    contradictions,
  };
}

function resolveAssessment(
  positive: MatchSignalStrength | null,
  negative: ContradictionStrength | null,
  strongNegativeAlwaysDominates: boolean,
): DimensionAssessment {
  if (positive === null && negative === null) return "UNKNOWN";
  if (negative === null) return positiveAssessment(positive!);
  if (positive === null) return negativeAssessment(negative);

  const positiveRank = signalRank(positive);
  const negativeRank = contradictionRank(negative);
  if (
    (strongNegativeAlwaysDominates && negativeRank >= 3) ||
    negativeRank >= positiveRank
  ) {
    return negativeAssessment(negative);
  }
  return positiveAssessment(positive);
}

function strongestSignal(
  signals: readonly EmployerMatchSignal[],
): MatchSignalStrength | null {
  return signals.reduce<MatchSignalStrength | null>(
    (strongest, signal) =>
      strongest === null || signalRank(signal.strength) > signalRank(strongest)
        ? signal.strength
        : strongest,
    null,
  );
}

function strongestContradiction(
  contradictions: readonly EmployerMatchContradiction[],
): ContradictionStrength | null {
  return contradictions.reduce<ContradictionStrength | null>(
    (strongest, contradiction) =>
      strongest === null ||
      contradictionRank(contradiction.strength) > contradictionRank(strongest)
        ? contradiction.strength
        : strongest,
    null,
  );
}

function signalRank(strength: MatchSignalStrength): number {
  return { WEAK: 1, MEDIUM: 2, STRONG: 3, VERY_STRONG: 4 }[strength];
}

function contradictionRank(strength: ContradictionStrength): number {
  return { WEAK: 1, MODERATE: 2, STRONG: 3, DECISIVE: 4 }[strength];
}

function positiveAssessment(strength: MatchSignalStrength): DimensionAssessment {
  return `${strength}_POSITIVE`;
}

function negativeAssessment(
  strength: ContradictionStrength,
): DimensionAssessment {
  return `${strength}_NEGATIVE`;
}

function uniqueCharacteristicSignals(
  signals: readonly EmployerMatchSignal[],
): EmployerMatchSignal[] {
  return uniqueByKey(
    signals,
    (signal) =>
      `${characteristicEvidenceKey(signal.leftEvidence)}\u0001${characteristicEvidenceKey(signal.rightEvidence)}`,
  );
}

function uniqueCharacteristicContradictions(
  contradictions: readonly EmployerMatchContradiction[],
): EmployerMatchContradiction[] {
  return uniqueByKey(
    contradictions,
    (contradiction) =>
      `${characteristicEvidenceKey(contradiction.leftEvidence)}\u0001${characteristicEvidenceKey(contradiction.rightEvidence)}`,
  );
}

function characteristicEvidenceKey(evidence: { readonly value: string }): string {
  const category = "category" in evidence ? String(evidence.category) : "UNKNOWN";
  return `${category}\u0000${normalize(evidence.value)}`;
}

function uniqueByKey<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
