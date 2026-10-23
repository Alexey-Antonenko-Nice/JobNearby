import type { EmployerCluster } from "../recognition/EmployerCluster.js";
import type { ObservationClusterAssignment } from "../recognition/ObservationClusterAssignment.js";
export const humanOrganizationRoles = ["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"] as const;
export type HumanOrganizationRole = typeof humanOrganizationRoles[number];
export interface VacancyOrganizationRoleDecision {
  readonly id: string;
  readonly canonicalVacancyId: string;
  readonly identityKey: string;
  readonly organizationName: string;
  readonly normalizedName: string;
  readonly role: HumanOrganizationRole;
  readonly previousDecisionId: string | null;
  readonly basis: Readonly<Record<string, unknown>>;
  readonly overrideAcknowledged: boolean;
  readonly createdAt: Date;
}
export interface OrganizationRoleReviewItem {
  readonly identityKey: string;
  readonly name: string;
  readonly recommendedRole: HumanOrganizationRole | "UNKNOWN";
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly evidenceStrength: "EXPLICIT" | "CONTEXTUAL" | "HISTORY" | "UNKNOWN";
  readonly confirmedRole: HumanOrganizationRole | null;
  readonly candidateToken: string;
  readonly history: readonly {
    readonly role: HumanOrganizationRole;
    readonly vacancyId: string | null;
    readonly recordedAt: string;
  }[];
  readonly actions: readonly {
    readonly role: HumanOrganizationRole;
    readonly warning: string | null;
  }[];
}
export interface VacancyOrganizationRoleDecisionRepository {
  listForVacancy(vacancyId: string): Promise<readonly VacancyOrganizationRoleDecision[]>;
  listForIdentity(identityKey: string): Promise<readonly VacancyOrganizationRoleDecision[]>;
  findById(id: string): Promise<VacancyOrganizationRoleDecision | null>;
  listLegacyEmployerHistory?(normalizedName: string): Promise<readonly {
    readonly role: "EMPLOYER";
    readonly vacancyId: string;
    readonly recordedAt: string;
  }[]>;
  commit(input: {
    readonly decision: VacancyOrganizationRoleDecision;
    readonly expectedObservationIds: readonly string[];
    readonly assignmentChanges: readonly {
      readonly expectedId: string | null;
      readonly replacement: ObservationClusterAssignment;
    }[];
    readonly expectedAssignments: readonly {
      readonly observationId: string;
      readonly assignmentId: string | null;
    }[];
    readonly newCluster?: EmployerCluster;
    readonly agencyEvidenceIds: readonly string[];
  }): Promise<void>;
}
