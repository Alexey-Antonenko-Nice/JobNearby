import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export type EmployerCharacteristicCategory =
  | "INDUSTRY"
  | "PRODUCT"
  | "PROCESS"
  | "EQUIPMENT"
  | "COMPANY_SIZE"
  | "ORGANIZATION"
  | "MARKET"
  | "LANGUAGE"
  | "WORK_PATTERN"
  | "OTHER";

export interface EmployerCharacteristicEvidence {
  readonly value: string;
  readonly category: EmployerCharacteristicCategory;
  readonly provenance: EvidenceProvenance;
}

export function createEmployerCharacteristicEvidence(
  evidence: EmployerCharacteristicEvidence,
): EmployerCharacteristicEvidence {
  return {
    value: requireEvidenceText(
      evidence.value,
      "Employer characteristic evidence value",
    ),
    category: evidence.category,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
