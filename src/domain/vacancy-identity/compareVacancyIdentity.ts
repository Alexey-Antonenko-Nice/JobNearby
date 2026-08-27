import type { ExternalIdentifierEvidence } from "../evidence/ExternalIdentifierEvidence.js";
import type { ExtractedVacancyEvidence } from "../evidence/ExtractedVacancyEvidence.js";
import type {
  VacancyIdentityComparison,
  VacancyIdentityComparisonReason,
} from "./VacancyIdentityComparison.js";

const SOURCE_EXTERNAL_IDENTIFIER_TYPE = "SOURCE_EXTERNAL_ID";

export function compareVacancyIdentity(
  left: ExtractedVacancyEvidence,
  right: ExtractedVacancyEvidence,
): VacancyIdentityComparison {
  const leftIdentifiers = sourceExternalIdentifiers(left);
  const rightIdentifiers = sourceExternalIdentifiers(right);

  for (const leftIdentifier of leftIdentifiers) {
    const rightIdentifier = rightIdentifiers.find(
      (candidate) =>
        normalizeProvider(candidate.provider) ===
          normalizeProvider(leftIdentifier.provider) &&
        candidate.value === leftIdentifier.value,
    );
    if (rightIdentifier !== undefined) {
      return {
        result: "SAME_VACANCY",
        reason: "EXACT_PROVIDER_EXTERNAL_ID_MATCH",
        leftObservationId: left.sourceObservationId,
        rightObservationId: right.sourceObservationId,
        matchedExternalIdentifier: {
          providerNamespace: normalizeProvider(leftIdentifier.provider),
          value: leftIdentifier.value,
          leftEvidence: leftIdentifier,
          rightEvidence: rightIdentifier,
        },
      };
    }
  }

  return unresolved(
    left,
    right,
    unresolvedReason(leftIdentifiers, rightIdentifiers),
  );
}

function sourceExternalIdentifiers(
  evidence: ExtractedVacancyEvidence,
): readonly ExternalIdentifierEvidence[] {
  return evidence.externalIdentifiers.filter(
    ({ identifierType }) => identifierType === SOURCE_EXTERNAL_IDENTIFIER_TYPE,
  );
}

function unresolvedReason(
  left: readonly ExternalIdentifierEvidence[],
  right: readonly ExternalIdentifierEvidence[],
): VacancyIdentityComparisonReason {
  if (left.length === 0 || right.length === 0) return "MISSING_EXTERNAL_ID";
  const leftProviders = new Set(
    left.map(({ provider }) => normalizeProvider(provider)),
  );
  return right.some(({ provider }) =>
    leftProviders.has(normalizeProvider(provider)),
  )
    ? "EXTERNAL_ID_MISMATCH"
    : "PROVIDER_NAMESPACE_MISMATCH";
}

function unresolved(
  left: ExtractedVacancyEvidence,
  right: ExtractedVacancyEvidence,
  reason: VacancyIdentityComparisonReason,
): VacancyIdentityComparison {
  return {
    result: "UNRESOLVED",
    reason,
    leftObservationId: left.sourceObservationId,
    rightObservationId: right.sourceObservationId,
  };
}

function normalizeProvider(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
