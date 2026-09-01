import {
  compareUserVacancyInteractionEvents,
  createUserVacancyInteractionEvent,
  type UserVacancyInteractionEvent,
} from "../../domain/user/UserVacancyInteractionEvent.js";
import type { UserVacancyInteractionRepository } from "../../domain/user/UserVacancyInteractionRepository.js";

export class InMemoryUserVacancyInteractionRepository
  implements UserVacancyInteractionRepository {
  private readonly events = new Map<string, UserVacancyInteractionEvent>();

  async append(event: UserVacancyInteractionEvent): Promise<void> {
    const validated = createUserVacancyInteractionEvent(event);
    if (this.events.has(validated.id)) {
      throw new Error(`User vacancy interaction event "${validated.id}" already exists.`);
    }
    this.events.set(validated.id, validated);
  }

  async findByCanonicalVacancyId(canonicalVacancyId: string) {
    return [...this.events.values()]
      .filter((event) => event.canonicalVacancyId === canonicalVacancyId)
      .sort(compareUserVacancyInteractionEvents)
      .map((event) => structuredClone(event));
  }
}
