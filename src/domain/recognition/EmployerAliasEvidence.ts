import { normalizeOrganizationEvidenceName } from "../evidence/OrganizationEvidence.js";

export interface EmployerAliasEvidence {
  readonly id: string;
  readonly aliasName: string;
  readonly normalizedAliasName: string;
  readonly employerClusterId: string;
  readonly sourceType: "USER_CONFIRMED_ALIAS";
  readonly sourceAssignmentId: string;
  readonly createdAt: Date;
  readonly explanation: string;
}

export function validateEmployerAliasEvidence(evidence: EmployerAliasEvidence): void {
  if (!evidence.id.trim() || !evidence.aliasName.trim() || !evidence.normalizedAliasName.trim()
    || !evidence.employerClusterId.trim() || !evidence.sourceAssignmentId.trim()
    || !evidence.explanation.trim() || evidence.sourceType !== "USER_CONFIRMED_ALIAS"
    || Number.isNaN(evidence.createdAt.getTime())
    || normalizeOrganizationEvidenceName(evidence.aliasName) !== evidence.normalizedAliasName) {
    throw new Error("Invalid employer alias evidence.");
  }
}

export interface EmployerAliasEvidenceRepository {
  save(evidence: EmployerAliasEvidence): Promise<void>;
  /** Only evidence supported by a currently effective human confirmation. */
  findActiveByNormalizedName(normalizedName: string): Promise<readonly EmployerAliasEvidence[]>;
  /** Full audit history, including evidence whose supporting assignment changed. */
  findByClusterId(employerClusterId: string): Promise<readonly EmployerAliasEvidence[]>;
}
