import type { VacancyEngagement } from "../vacancies/CanonicalVacancy.js";
import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export interface VacancyEngagementEvidence extends VacancyEngagement {
  readonly provenance: EvidenceProvenance;
}

export function createVacancyEngagementEvidence(
  evidence: VacancyEngagementEvidence,
): VacancyEngagementEvidence {
  if (evidence.rawTerms.length === 0 || evidence.normalizedTerms.length === 0) {
    throw new Error("Vacancy engagement evidence requires raw and normalized terms.");
  }
  return {
    rawTerms: evidence.rawTerms.map((value) =>
      requireEvidenceText(value, "Vacancy engagement raw term"),
    ),
    normalizedTerms: evidence.normalizedTerms.map((value) =>
      requireEvidenceText(value, "Vacancy engagement normalized term"),
    ),
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
