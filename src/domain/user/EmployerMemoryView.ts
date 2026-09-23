import type { EmployerClusterId, EmployerClusterStatus } from "../recognition/EmployerCluster.js";
import type {
  CanonicalVacancyId,
  CanonicalizationStatus,
  VacancyLocation,
  VacancyOrganizationRole,
} from "../vacancies/CanonicalVacancy.js";
import type { UserVacancyState } from "./UserVacancyInteractionEvent.js";

export interface EmployerMemoryOrganizationRelationship {
  readonly organizationId?: string;
  readonly employerClusterId?: EmployerClusterId;
  readonly rawName?: string;
  readonly role: VacancyOrganizationRole;
}

export interface EmployerMemoryVacancy {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly canonicalizationStatus: CanonicalizationStatus;
  readonly title: string | null;
  readonly location: VacancyLocation | null;
  readonly latestObservedAt: Date | null;
  readonly sources?: readonly string[];
  readonly sourceObservationCount: number;
  readonly currentUserState: UserVacancyState;
  readonly lastUserInteractionAt: Date | null;
  readonly everContacted: boolean;
  readonly everOffered: boolean;
  readonly everWithdrawn: boolean;
  readonly everApplied: boolean;
  readonly everInterviewed: boolean;
  readonly everRejected: boolean;
  readonly organizationRelationships: readonly EmployerMemoryOrganizationRelationship[];
  readonly recruiterConsultancyRelationships: readonly EmployerMemoryOrganizationRelationship[];
}

export interface EmployerMemoryOrganizationSeen {
  readonly rawName: string;
  readonly role: VacancyOrganizationRole;
  readonly canonicalVacancyIds: readonly CanonicalVacancyId[];
  readonly observationCount: number;
}

export interface EmployerMemoryView {
  readonly employerCluster: {
    readonly id: EmployerClusterId;
    readonly status: EmployerClusterStatus;
    readonly displayLabel?: string;
    readonly resolvedEmployerId?: string;
  };
  readonly knownNames: readonly string[];
  readonly organizationsSeen: readonly EmployerMemoryOrganizationSeen[];
  readonly vacancies: readonly EmployerMemoryVacancy[];
  readonly summary: {
    readonly vacancyCount: number;
    readonly interactedVacancyCount: number;
    readonly everContactedCount: number;
    readonly everOfferedCount: number;
    readonly everWithdrawnCount: number;
    readonly everAppliedCount: number;
    readonly everInterviewedCount: number;
    readonly everRejectedCount: number;
    readonly currentStateCounts: Readonly<Partial<Record<UserVacancyState, number>>>;
    readonly latestVacancyObservedAt: Date | null;
    readonly latestUserInteractionAt: Date | null;
  };
}
