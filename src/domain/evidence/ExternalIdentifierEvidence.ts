import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export interface ExternalIdentifierEvidence {
  readonly value: string;
  readonly provider: string;
  readonly identifierType: string;
  readonly provenance: EvidenceProvenance;
}

export function createExternalIdentifierEvidence(
  evidence: ExternalIdentifierEvidence,
): ExternalIdentifierEvidence {
  return {
    value: requireEvidenceText(evidence.value, "External identifier value"),
    provider: requireEvidenceText(
      evidence.provider,
      "External identifier provider",
    ),
    identifierType: requireEvidenceText(
      evidence.identifierType,
      "External identifier type",
    ),
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
