import type {
  CanonicalVacancy,
  CanonicalVacancyId,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import { validateCanonicalVacancy } from "../../domain/vacancies/validateCanonicalVacancy.js";

export class InMemoryCanonicalVacancyRepository
  implements CanonicalVacancyRepository
{
  private readonly vacancies = new Map<CanonicalVacancyId, CanonicalVacancy>();

  async save(vacancy: CanonicalVacancy): Promise<void> {
    const validated = validateCanonicalVacancy(vacancy);
    this.vacancies.set(validated.id, clone(validated));
  }

  async findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null> {
    const vacancy = this.vacancies.get(id);
    return vacancy === undefined ? null : clone(vacancy);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
