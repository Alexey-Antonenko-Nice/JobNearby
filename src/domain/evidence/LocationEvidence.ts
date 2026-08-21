import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export type LocationEvidenceRole =
  | "DISPLAYED_LOCATION"
  | "WORKPLACE"
  | "EMPLOYER_LOCATION"
  | "RECRUITER_LOCATION"
  | "SERVICE_TERRITORY"
  | "UNKNOWN";

export interface LocationEvidence {
  readonly value: string;
  readonly role: LocationEvidenceRole;
  readonly provenance: EvidenceProvenance;
}

export function createLocationEvidence(
  evidence: LocationEvidence,
): LocationEvidence {
  return {
    value: requireEvidenceText(evidence.value, "Location evidence value"),
    role: evidence.role,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
