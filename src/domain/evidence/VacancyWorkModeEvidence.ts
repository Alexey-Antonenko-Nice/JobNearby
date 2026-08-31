import type { VacancyWorkMode } from "../vacancies/CanonicalVacancy.js";
import {
  createEvidenceProvenance,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export interface VacancyWorkModeEvidence {
  readonly value: VacancyWorkMode;
  readonly provenance: EvidenceProvenance;
}

const workModes: readonly VacancyWorkMode[] = ["ON_SITE", "HYBRID", "REMOTE"];

export function createVacancyWorkModeEvidence(
  evidence: VacancyWorkModeEvidence,
): VacancyWorkModeEvidence {
  if (!workModes.includes(evidence.value)) {
    throw new Error("Vacancy work mode evidence value is invalid.");
  }
  return {
    value: evidence.value,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
