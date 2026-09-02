import type { EmployerClusterId, EmployerClusterStatus } from "../recognition/EmployerCluster.js";
import type { UserVacancyState } from "./UserVacancyInteractionEvent.js";
import type { CanonicalVacancyId, CanonicalizationStatus, VacancyEngagement, VacancyLocation, VacancyWorkMode } from "../vacancies/CanonicalVacancy.js";

export interface VacancyInboxItem {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly canonicalizationStatus: CanonicalizationStatus;
  readonly title: string | null;
  readonly location: VacancyLocation | null;
  readonly engagement: VacancyEngagement | null;
  readonly workMode: VacancyWorkMode | null;
  readonly latestObservedAt: Date | null;
  readonly firstObservedAt: Date | null;
  readonly sourceObservationCount: number;
  readonly userState: UserVacancyState;
  readonly lastUserInteractionAt: Date | null;
  readonly employer: { readonly employerClusterId: EmployerClusterId | null; readonly status: EmployerClusterStatus | null; readonly knownBefore: boolean; readonly unresolvedEmployer: boolean };
  readonly organizations: { readonly employerName: string | null; readonly displayedCompanyNames: readonly string[]; readonly recruiterNames: readonly string[]; readonly consultancyNames: readonly string[] };
  readonly signals: { readonly sameCanonicalVacancySeenBefore: boolean; readonly hasMultipleSourceObservations: boolean; readonly alreadyAppliedToThisVacancy: boolean };
}