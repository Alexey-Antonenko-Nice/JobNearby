import type {
  CanonicalVacancy,
  CanonicalVacancyId,
} from "./CanonicalVacancy.js";

export interface CanonicalVacancyRepository {
  save(vacancy: CanonicalVacancy): Promise<void>;
  findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null>;
}
