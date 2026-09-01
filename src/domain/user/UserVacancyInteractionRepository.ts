import type { CanonicalVacancyId } from "../vacancies/CanonicalVacancy.js";
import type { UserVacancyInteractionEvent } from "./UserVacancyInteractionEvent.js";

export interface UserVacancyInteractionRepository {
  append(event: UserVacancyInteractionEvent): Promise<void>;
  findByCanonicalVacancyId(
    canonicalVacancyId: CanonicalVacancyId,
  ): Promise<readonly UserVacancyInteractionEvent[]>;
}
