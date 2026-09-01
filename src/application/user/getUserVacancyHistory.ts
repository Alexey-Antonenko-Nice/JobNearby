import type { CanonicalVacancyId } from "../../domain/vacancies/CanonicalVacancy.js";
import {
  compareUserVacancyInteractionEvents,
  deriveUserVacancyState,
  type UserVacancyInteractionEvent,
  type UserVacancyState,
} from "../../domain/user/UserVacancyInteractionEvent.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";

export interface UserVacancyHistory {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly currentState: UserVacancyState;
  readonly events: readonly UserVacancyInteractionEvent[];
}

export async function getUserVacancyHistory(
  canonicalVacancyId: CanonicalVacancyId,
  repository: UserVacancyInteractionRepository,
): Promise<UserVacancyHistory> {
  if (canonicalVacancyId.trim().length === 0) throw new Error("Canonical vacancy ID is required.");
  const events = [...await repository.findByCanonicalVacancyId(canonicalVacancyId)]
    .sort(compareUserVacancyInteractionEvents);
  return { canonicalVacancyId, currentState: deriveUserVacancyState(events), events };
}
