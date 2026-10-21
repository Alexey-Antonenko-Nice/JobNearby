import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { CanonicalVacancy } from "../../domain/vacancies/CanonicalVacancy.js";
import { createVacancyEvidenceExtractor } from "../evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer, resolveCanonicalField } from "../vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { hasSingleExactVacancyIdentity } from "../vacancies/resolveTemporalCompensationEvidence.js";
import type { CompensationHistoryEntry } from "../../domain/vacancies/CompensationHistoryEntry.js";
import { evidenceExtractionInputFor } from "../vacancies/processVacancyObservation.js";

/** Reopening old projections can apply the same compensation policy without writes. */
export async function getVacancyCompensationProjection(vacancy: CanonicalVacancy, observations: readonly SourceObservation[]) {
  const unchanged = { compensation: vacancy.compensation, canonicalizationStatus: vacancy.canonicalizationStatus, history: [] as readonly CompensationHistoryEntry[] };
  if (observations.length < 2 || !hasSingleExactVacancyIdentity(observations)) return unchanged;
  const extractor = createVacancyEvidenceExtractor();
  const adapter = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer());
  const input = adapter.buildCanonicalizeInput({ canonicalVacancyId: vacancy.id, observations,
    extractedEvidence: await Promise.all(observations.map((observation) => extractor.extract(evidenceExtractionInputFor(observation)))), derivation: vacancy.derivation });
  if (input.compensationHistory.length === 0) return unchanged;
  const compensation = resolveCanonicalField(input.compensationCandidates ?? [], new Set(input.evidenceReferences.map(({ id }) => id)), vacancy.derivation);
  const otherConflict = Object.entries(vacancy).some(([key, value]) => key !== "compensation" && value !== null
    && typeof value === "object" && "status" in value && value.status === "CONFLICTED");
  const canonicalizationStatus = compensation.status === "CONFLICTED" || otherConflict ? "CONFLICTED" as const
    : vacancy.role.status === "RESOLVED" ? "USABLE" as const : "PARTIAL" as const;
  return { compensation, canonicalizationStatus, history: input.compensationHistory };
}
