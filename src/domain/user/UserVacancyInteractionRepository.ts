import type { CanonicalVacancyId } from "../vacancies/CanonicalVacancy.js";
import type { UserVacancyInteractionEvent } from "./UserVacancyInteractionEvent.js";

export interface UserVacancyInteractionRepository {
  findByCanonicalVacancyIds?(ids: readonly CanonicalVacancyId[]): Promise<readonly UserVacancyInteractionEvent[]>;
  append(event: UserVacancyInteractionEvent): Promise<void>;
  findByCanonicalVacancyId(
    canonicalVacancyId: CanonicalVacancyId,
  ): Promise<readonly UserVacancyInteractionEvent[]>;
}
