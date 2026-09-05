import type { EmployerClusterId, EmployerClusterStatus } from "../recognition/EmployerCluster.js";
import type {
  CanonicalVacancyId,
  CanonicalizationStatus,
  VacancyCompensation,
  VacancyEngagement,
  VacancyLocation,
  VacancyOrganizationRole,
  VacancyWorkMode,
} from "../vacancies/CanonicalVacancy.js";
import type { UserVacancyState } from "./UserVacancyInteractionEvent.js";
import type { VacancySourceLink } from "./VacancySourceLink.js";

export interface VacancyReviewOrganizationRelationship {
  readonly organizationId?: string;
  readonly employerClusterId?: EmployerClusterId;
  readonly rawName?: string;
  readonly role: VacancyOrganizationRole;
}

export interface VacancyReviewView {
  readonly vacancy: {
    readonly canonicalVacancyId: CanonicalVacancyId;
    readonly canonicalizationStatus: CanonicalizationStatus;
    readonly title: string | null;
    readonly location: VacancyLocation | null;
    readonly engagement: VacancyEngagement | null;
    readonly workMode: VacancyWorkMode | null;
    readonly compensation: VacancyCompensation | null;
    readonly latestObservedAt: Date | null;
    readonly sourceObservationCount: number;
    readonly sourceLinks: readonly VacancySourceLink[];
  };
  readonly user: {
    readonly currentState: UserVacancyState;
    readonly lastInteractionAt: Date | null;
    readonly everApplied: boolean;
    readonly everInterviewed: boolean;
    readonly everRejected: boolean;
  };
  readonly employer: {
    readonly employerClusterId: EmployerClusterId | null;
    readonly status: EmployerClusterStatus | null;
    readonly resolvedEmployerId: string | null;
    readonly knownBefore: boolean;
    readonly previousVacancyCount: number;
    readonly previousInteractedVacancyCount: number;
    readonly everAppliedToEmployer: boolean;
    readonly everInterviewedWithEmployer: boolean;
    readonly everRejectedByEmployer: boolean;
  };
  readonly organizations: {
    readonly employerRelationships: readonly VacancyReviewOrganizationRelationship[];
    readonly displayedCompanies: readonly VacancyReviewOrganizationRelationship[];
    readonly recruiters: readonly VacancyReviewOrganizationRelationship[];
    readonly consultancies: readonly VacancyReviewOrganizationRelationship[];
    readonly staffingAgencies: readonly VacancyReviewOrganizationRelationship[];
    readonly clients: readonly VacancyReviewOrganizationRelationship[];
    readonly otherRelationships: readonly VacancyReviewOrganizationRelationship[];
  };
  readonly recognition: {
    readonly sameCanonicalVacancySeenBefore: boolean;
    readonly employerSeenBefore: boolean;
    readonly unresolvedEmployer: boolean;
  };
  readonly reviewSignals: {
    readonly isNewVacancy: boolean;
    readonly isKnownEmployer: boolean;
    readonly alreadyAppliedToThisVacancy: boolean;
    readonly previouslyAppliedToEmployer: boolean;
    readonly previouslyInterviewedWithEmployer: boolean;
    readonly previouslyRejectedByEmployer: boolean;
    readonly hasMultipleSourceObservations: boolean;
  };
}
