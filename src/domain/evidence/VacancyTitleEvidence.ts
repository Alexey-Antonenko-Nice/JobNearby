import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export interface VacancyTitleEvidence {
  readonly value: string;
  readonly provenance: EvidenceProvenance;
}

export function createVacancyTitleEvidence(
  evidence: VacancyTitleEvidence,
): VacancyTitleEvidence {
  return {
    value: requireEvidenceText(evidence.value, "Vacancy title evidence value"),
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
