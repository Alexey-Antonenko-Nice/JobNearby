import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type {
  CanonicalVacancyId,
  CanonicalizationStatus,
  VacancyLocation,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type { EmployerMemoryOrganizationRelationship } from "../../domain/user/EmployerMemoryView.js";

export interface EmployerMemoryPublicVacancy {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly canonicalizationStatus: CanonicalizationStatus;
  readonly title: string | null;
  readonly location: VacancyLocation | null;
  readonly latestObservedAt: Date | null;
  readonly sourceObservationCount: number;
  readonly organizationRelationships: readonly EmployerMemoryOrganizationRelationship[];
}

export interface EmployerMemoryPublicDataSource {
  findByEmployerClusterId(
    employerClusterId: EmployerClusterId,
  ): Promise<readonly EmployerMemoryPublicVacancy[]>;
}
