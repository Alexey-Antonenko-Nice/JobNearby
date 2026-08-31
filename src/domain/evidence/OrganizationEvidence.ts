import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export type OrganizationEvidenceRole =
  | "EMPLOYER"
  | "RECRUITMENT_AGENCY"
  | "STAFFING_AGENCY"
  | "RECRUITER"
  | "CONSULTANCY"
  | "CLIENT"
  | "PUBLISHER"
  | "UNKNOWN";

export interface OrganizationEvidence {
  readonly value: string;
  readonly normalizedName?: string;
  readonly role: OrganizationEvidenceRole;
  readonly provenance: EvidenceProvenance;
}

export function createOrganizationEvidence(
  evidence: OrganizationEvidence,
): OrganizationEvidence {
  const value = requireEvidenceText(evidence.value, "Organization evidence value");
  return {
    value,
    ...(evidence.normalizedName === undefined
      ? {}
      : {
          normalizedName: requireEvidenceText(
            evidence.normalizedName,
            "Normalized organization evidence name",
          ),
        }),
    role: evidence.role,
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}

export function normalizeOrganizationEvidenceName(value: string): string {
  return requireEvidenceText(value, "Organization evidence value")
    .normalize("NFKC")
    .replace(/[\s\-‐‑‒–—]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}
