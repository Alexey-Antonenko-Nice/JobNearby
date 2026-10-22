export type AgencyRole = "RECRUITER" | "STAFFING_AGENCY";

export interface ConfirmedOrganizationRole {
  readonly id: string;
  readonly identityKey: string;
  readonly organizationId?: string;
  readonly organizationName: string;
  readonly normalizedName: string;
  readonly role: AgencyRole;
  readonly source: "USER_CONFIRMED";
  readonly sourceVacancyId: string;
  readonly sourceObservationId: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly createdAt: Date;
}

export interface ConfirmedOrganizationRoleRepository {
  findByNormalizedName(name: string): Promise<readonly ConfirmedOrganizationRole[]>;
  /** False means this identity/name/role was already confirmed, including a concurrent POST. */
  append(record: ConfirmedOrganizationRole): Promise<boolean>;
}

export interface AgencyReviewContext {
  readonly candidates: readonly { candidateId: string; name: string; role: AgencyRole }[];
  readonly known: readonly { name: string; role: AgencyRole; memoryId: string; source: "USER_CONFIRMED" | "AGENCY_MEMORY" }[];
  readonly ambiguousNames: readonly string[];
}
