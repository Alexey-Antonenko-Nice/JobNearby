import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export type PersonEvidenceRole = "RECRUITER" | "CONTACT" | "UNKNOWN";

export interface PersonEvidence {
  readonly value: string;
  readonly role: PersonEvidenceRole;
  readonly provenance: EvidenceProvenance;
}

export function createPersonEvidence(evidence: PersonEvidence): PersonEvidence {
  return {
    value: requireEvidenceText(evidence.value, "Person evidence value"),
    role: evidence.role,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
