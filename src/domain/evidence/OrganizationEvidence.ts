import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export type OrganizationEvidenceRole =
  | "EMPLOYER"
  | "RECRUITMENT_AGENCY"
  | "STAFFING_AGENCY"
  | "PUBLISHER"
  | "UNKNOWN";

export interface OrganizationEvidence {
  readonly value: string;
  readonly role: OrganizationEvidenceRole;
  readonly provenance: EvidenceProvenance;
}

export function createOrganizationEvidence(
  evidence: OrganizationEvidence,
): OrganizationEvidence {
  return {
    value: requireEvidenceText(evidence.value, "Organization evidence value"),
    role: evidence.role,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
