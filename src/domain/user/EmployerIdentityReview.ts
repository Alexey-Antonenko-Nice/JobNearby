import type { ObservationClusterAssignment } from "../recognition/ObservationClusterAssignment.js";

export const EMPLOYER_IDENTITY_ALGORITHM = "user-employer-identity";
export const EMPLOYER_IDENTITY_STALE = "Employer identity review is stale. Refresh the vacancy.";
export interface EmployerIdentityReview {
  readonly currentClusterId: string;
  readonly employerName: string;
  readonly candidates: readonly {
    readonly employerClusterId: string;
    readonly displayLabel: string;
    readonly candidateToken: string;
    readonly keptSeparate: boolean;
    readonly advisoryReasons: readonly string[];
    readonly priorVacancies: readonly { readonly canonicalVacancyId: string; readonly title: string | null; readonly location: string | null }[];
  }[];
}
export interface EmployerIdentityDecisionInput {
  readonly canonicalVacancyId: string;
  readonly requestId: string;
  readonly employerClusterId: string;
  readonly candidateToken: string;
  readonly decision: "USE_EXISTING" | "KEEP_SEPARATE";
}
export interface EmployerIdentityDecisionStore {
  commit(input: {
    readonly canonicalVacancyId: string;
    readonly expectedIdentityHistoryIds: readonly string[];
    readonly expectedRoleDecisionId: string | null;
    readonly expectedAssignments: readonly { readonly observationId: string; readonly assignmentId: string }[];
    readonly expectedTargetAssignmentIds: readonly string[];
    readonly targetClusterId: string;
    readonly assignments: readonly ObservationClusterAssignment[];
    readonly decision: "USE_EXISTING" | "KEEP_SEPARATE";
  }): Promise<void>;
}
