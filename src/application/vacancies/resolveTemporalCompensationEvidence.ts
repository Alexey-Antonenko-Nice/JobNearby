import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { CanonicalEvidenceReference } from "../../domain/vacancies/CanonicalEvidenceReference.js";
import { normalizeVacancyProviderNamespace } from "../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";
import type { CanonicalCandidate } from "./CanonicalVacancyCanonicalizer.js";

/** No publication/source authority is inferred from canonical membership alone. */
export function hasSingleExactVacancyIdentity(observations: readonly SourceObservation[]): boolean {
  const first = observations[0];
  if (!first?.source.externalId?.trim()) return false;
  const provider = normalizeVacancyProviderNamespace(first.source.sourceName);
  return provider.length > 0 && observations.every((observation) =>
    observation.source.externalId === first.source.externalId
    && normalizeVacancyProviderNamespace(observation.source.sourceName) === provider
    && Number.isFinite(observation.observedAt.getTime()));
}

/** Compensation-only policy: select latest explicit snapshots before value
 * reconciliation. Equal-time and same-snapshot contradictions survive. */
export function resolveTemporalCompensationEvidence<T>(
  observations: readonly SourceObservation[],
  candidates: readonly CanonicalCandidate<T>[],
  references: readonly CanonicalEvidenceReference[],
): { current: readonly CanonicalCandidate<T>[]; historical: readonly CanonicalCandidate<T>[] } {
  const unchanged = { current: candidates, historical: [] };
  if (candidates.length === 0 || !hasSingleExactVacancyIdentity(observations)) return unchanged;
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const sources = new Map(references.map((reference) => [reference.id, reference.sourceObservationId]));
  const times: number[] = [];
  for (const candidate of candidates) {
    const ids = new Set(candidate.supportingEvidenceIds.map((id) => sources.get(id)));
    if (ids.size !== 1 || ids.has(undefined)) return unchanged;
    const observation = byId.get([...ids][0]!);
    if (!observation) return unchanged;
    times.push(observation.observedAt.getTime());
  }
  const latest = Math.max(...times);
  return {
    current: candidates.filter((_, index) => times[index] === latest),
    historical: candidates.filter((_, index) => times[index]! < latest),
  };
}
