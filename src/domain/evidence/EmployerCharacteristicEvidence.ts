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
  | "INFRASTRUCTURE"
  | "COMPANY_SIZE"
  | "ORGANIZATION"
  | "MARKET"
  | "WORK_PATTERN"
  | "DISTINCTIVE_FACT"
  | "OTHER";

export type EvidenceSpecificity =
  | "VERY_LOW"
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "VERY_HIGH";

export interface EmployerCharacteristicEvidence {
  readonly value: string;
  readonly category: EmployerCharacteristicCategory;
  readonly specificity: EvidenceSpecificity;
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
    specificity: evidence.specificity,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
