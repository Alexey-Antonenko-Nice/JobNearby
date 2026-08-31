import type { VacancyCompensation } from "../vacancies/CanonicalVacancy.js";
import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export interface VacancyCompensationEvidence extends VacancyCompensation {
  readonly rawText: string;
  readonly provenance: EvidenceProvenance;
}

export function createVacancyCompensationEvidence(
  evidence: VacancyCompensationEvidence,
): VacancyCompensationEvidence {
  for (const amount of [evidence.minimum, evidence.maximum]) {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      throw new Error("Vacancy compensation amounts must be finite and non-negative.");
    }
  }
  if (evidence.minimum !== undefined && evidence.maximum !== undefined && evidence.minimum > evidence.maximum) {
    throw new Error("Vacancy compensation minimum cannot exceed maximum.");
  }
  return {
    rawText: requireEvidenceText(evidence.rawText, "Vacancy compensation raw text"),
    ...(evidence.currency === undefined
      ? {}
      : {
          currency: requireEvidenceText(
            evidence.currency,
            "Vacancy compensation currency",
          ),
        }),
    ...(evidence.minimum === undefined ? {} : { minimum: evidence.minimum }),
    ...(evidence.maximum === undefined ? {} : { maximum: evidence.maximum }),
    ...(evidence.period === undefined ? {} : { period: evidence.period }),
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
