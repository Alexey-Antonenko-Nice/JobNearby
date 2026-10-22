import { createEvidenceProvenance, requireEvidenceText, type EvidenceProvenance } from "./EvidenceProvenance.js";

export interface VacancyPositionCountEvidence {
  readonly rawText: string;
  readonly value: number;
  readonly provenance: EvidenceProvenance;
}

export function createVacancyPositionCountEvidence(input: VacancyPositionCountEvidence): VacancyPositionCountEvidence {
  if (!Number.isSafeInteger(input.value) || input.value < 1) throw new Error("Position count must be a positive integer.");
  return { rawText: requireEvidenceText(input.rawText, "Position count evidence"), value: input.value, provenance: createEvidenceProvenance(input.provenance) };
}
