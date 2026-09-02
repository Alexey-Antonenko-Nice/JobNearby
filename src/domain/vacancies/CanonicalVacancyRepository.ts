import type {
  CanonicalVacancy,
  CanonicalVacancyId,
} from "./CanonicalVacancy.js";
import type { SourceObservationId } from "../capture/SourceObservation.js";

export interface CanonicalVacancyIdentityClaim {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly outcome: "CLAIMED" | "EXISTING";
}

export interface CanonicalVacancySaveResult {
  readonly outcome: "CREATED" | "UPDATED_EXISTING";
}

export interface CanonicalVacancyRepository {
  save(vacancy: CanonicalVacancy): Promise<CanonicalVacancySaveResult>;
  findAll(): Promise<readonly CanonicalVacancy[]>;
  findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null>;
  findBySourceObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<CanonicalVacancy | null>;
  findByExactSourceIdentity(
    providerNamespace: string,
    externalId: string,
  ): Promise<CanonicalVacancy | null>;
  findClaimedSourceObservationIds(
    canonicalVacancyId: CanonicalVacancyId,
  ): Promise<readonly SourceObservationId[]>;
  claimIdentity(
    sourceObservationId: SourceObservationId,
    proposedCanonicalVacancyId: CanonicalVacancyId,
  ): Promise<CanonicalVacancyIdentityClaim>;
}
