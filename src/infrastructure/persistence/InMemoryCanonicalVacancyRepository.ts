import type {
  CanonicalVacancy,
  CanonicalVacancyId,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import { normalizeVacancyProviderNamespace } from "../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";
import { validateCanonicalVacancy } from "../../domain/vacancies/validateCanonicalVacancy.js";

export class InMemoryCanonicalVacancyRepository
  implements CanonicalVacancyRepository
{
  private readonly vacancies = new Map<CanonicalVacancyId, CanonicalVacancy>();

  constructor(
    private readonly sourceObservationRepository: SourceObservationRepository,
  ) {}

  async save(vacancy: CanonicalVacancy): Promise<void> {
    const validated = validateCanonicalVacancy(vacancy);
    this.vacancies.set(validated.id, clone(validated));
  }

  async findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null> {
    const vacancy = this.vacancies.get(id);
    return vacancy === undefined ? null : clone(vacancy);
  }

  async findByExactSourceIdentity(
    providerNamespace: string,
    externalId: string,
  ): Promise<CanonicalVacancy | null> {
    const normalizedProvider = normalizeVacancyProviderNamespace(providerNamespace);
    const matches: CanonicalVacancy[] = [];

    for (const vacancy of this.vacancies.values()) {
      let vacancyMatches = false;
      for (const observationId of vacancy.sourceObservationIds) {
        const observation =
          await this.sourceObservationRepository.findById(observationId);
        if (
          observation?.source.externalId === externalId &&
          normalizeVacancyProviderNamespace(observation.source.sourceName) ===
            normalizedProvider
        ) {
          vacancyMatches = true;
          break;
        }
      }
      if (vacancyMatches) matches.push(vacancy);
    }

    if (matches.length > 1) {
      throw new Error(
        `Canonical vacancy identity integrity error: provider "${normalizedProvider}" and external ID "${externalId}" belong to multiple canonical vacancies.`,
      );
    }

    return matches[0] === undefined ? null : clone(matches[0]);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
