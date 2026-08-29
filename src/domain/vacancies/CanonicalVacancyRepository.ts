import type {
  CanonicalVacancy,
  CanonicalVacancyId,
} from "./CanonicalVacancy.js";
import type { SourceObservationId } from "../capture/SourceObservation.js";

export interface CanonicalVacancyIdentityClaim {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly outcome: "CLAIMED" | "EXISTING";
}

export interface CanonicalVacancyRepository {
  save(vacancy: CanonicalVacancy): Promise<void>;
  findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null>;
  findBySourceObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<CanonicalVacancy | null>;
  findByExactSourceIdentity(
    providerNamespace: string,
    externalId: string,
  ): Promise<CanonicalVacancy | null>;
  claimIdentity(
    sourceObservationId: SourceObservationId,
    proposedCanonicalVacancyId: CanonicalVacancyId,
  ): Promise<CanonicalVacancyIdentityClaim>;
}
