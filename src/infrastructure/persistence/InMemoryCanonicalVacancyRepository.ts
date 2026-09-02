import type {
  CanonicalVacancy,
  CanonicalVacancyId,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import { normalizeVacancyProviderNamespace } from "../../domain/vacancy-identity/normalizeVacancyProviderNamespace.js";
import { validateCanonicalVacancy } from "../../domain/vacancies/validateCanonicalVacancy.js";
import { CanonicalVacancyStaleProjectionError } from "../../domain/vacancies/CanonicalVacancyPersistenceError.js";

export class InMemoryCanonicalVacancyRepository
  implements CanonicalVacancyRepository
{
  private readonly vacancies = new Map<CanonicalVacancyId, CanonicalVacancy>();
  private readonly observationClaims = new Map<
    SourceObservationId,
    CanonicalVacancyId
  >();
  private readonly exactIdentityClaims = new Map<string, CanonicalVacancyId>();

  constructor(
    private readonly sourceObservationRepository: SourceObservationRepository,
  ) {}

  async save(vacancy: CanonicalVacancy) {
    const validated = validateCanonicalVacancy(vacancy);
    const observations = await Promise.all(
      validated.sourceObservationIds.map(async (id) => {
        const observation = await this.sourceObservationRepository.findById(id);
        return { id, observation };
      }),
    );
    const nextObservationClaims = new Map(this.observationClaims);
    const nextExactIdentityClaims = new Map(this.exactIdentityClaims);
    for (const { id, observation } of observations) {
      const observationWinner = nextObservationClaims.get(id);
      if (observationWinner !== undefined && observationWinner !== validated.id) {
        throw membershipConflict(id, observationWinner, validated.id);
      }
      if (observation === null) continue;
      const externalId = observation.source.externalId;
      if (externalId === undefined) continue;
      const identityWinner = nextExactIdentityClaims.get(
        identityKey(observation.source.sourceName, externalId),
      );
      if (identityWinner !== undefined && identityWinner !== validated.id) {
        throw identityConflict(
          observation.source.sourceName,
          externalId,
          identityWinner,
          validated.id,
        );
      }
    }

    for (const { id, observation } of observations) {
      nextObservationClaims.set(id, validated.id);
      if (observation === null) continue;
      if (observation.source.externalId !== undefined) {
        nextExactIdentityClaims.set(
          identityKey(
            observation.source.sourceName,
            observation.source.externalId,
          ),
          validated.id,
        );
      }
    }
    const claimedIds = [...nextObservationClaims]
      .filter(([, canonicalVacancyId]) => canonicalVacancyId === validated.id)
      .map(([observationId]) => observationId);
    if (!sameSet(claimedIds, validated.sourceObservationIds)) {
      throw new CanonicalVacancyStaleProjectionError(validated.id);
    }
    const outcome = this.vacancies.has(validated.id)
      ? "UPDATED_EXISTING" as const
      : "CREATED" as const;
    this.observationClaims.clear();
    for (const [key, value] of nextObservationClaims) {
      this.observationClaims.set(key, value);
    }
    this.exactIdentityClaims.clear();
    for (const [key, value] of nextExactIdentityClaims) {
      this.exactIdentityClaims.set(key, value);
    }
    this.vacancies.set(validated.id, clone(validated));
    return { outcome };
  }

  async findById(id: CanonicalVacancyId): Promise<CanonicalVacancy | null> {
    const vacancy = this.vacancies.get(id);
    return vacancy === undefined ? null : clone(vacancy);
  }

  async findAll(): Promise<readonly CanonicalVacancy[]> {
    return [...this.vacancies.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(clone);
  }

  async findBySourceObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<CanonicalVacancy | null> {
    const vacancyId = this.observationClaims.get(sourceObservationId);
    if (vacancyId === undefined) return null;
    return this.findById(vacancyId);
  }

  async findByExactSourceIdentity(
    providerNamespace: string,
    externalId: string,
  ): Promise<CanonicalVacancy | null> {
    const normalizedProvider = normalizeVacancyProviderNamespace(providerNamespace);
    const vacancyId = this.exactIdentityClaims.get(
      identityKey(normalizedProvider, externalId),
    );
    if (vacancyId === undefined) return null;
    return this.findById(vacancyId);
  }

  async findClaimedSourceObservationIds(
    canonicalVacancyId: CanonicalVacancyId,
  ): Promise<readonly SourceObservationId[]> {
    return [...this.observationClaims]
      .filter(([, claimedCanonicalId]) => claimedCanonicalId === canonicalVacancyId)
      .map(([sourceObservationId]) => sourceObservationId)
      .sort((left, right) => left.localeCompare(right));
  }

  async claimIdentity(
    sourceObservationId: SourceObservationId,
    proposedCanonicalVacancyId: CanonicalVacancyId,
  ) {
    const observation =
      await this.sourceObservationRepository.findById(sourceObservationId);
    if (observation === null) {
      throw new Error(
        `Canonical vacancy identity claim requires existing SourceObservation "${sourceObservationId}".`,
      );
    }
    const observationWinner = this.observationClaims.get(sourceObservationId);
    const externalId = observation.source.externalId;
    const key =
      externalId === undefined
        ? undefined
        : identityKey(observation.source.sourceName, externalId);
    const identityWinner = key === undefined
      ? undefined
      : this.exactIdentityClaims.get(key);
    if (
      observationWinner !== undefined &&
      identityWinner !== undefined &&
      observationWinner !== identityWinner
    ) {
      throw new Error(
        `Canonical vacancy identity integrity error: observation and exact identity claims disagree for SourceObservation "${sourceObservationId}".`,
      );
    }
    const winner = observationWinner ?? identityWinner ?? proposedCanonicalVacancyId;
    this.observationClaims.set(sourceObservationId, winner);
    if (key !== undefined) this.exactIdentityClaims.set(key, winner);
    return {
      canonicalVacancyId: winner,
      outcome:
        observationWinner === undefined && identityWinner === undefined
          ? "CLAIMED" as const
          : "EXISTING" as const,
    };
  }
}

function identityKey(providerNamespace: string, externalId: string): string {
  return `${normalizeVacancyProviderNamespace(providerNamespace)}\u0000${externalId}`;
}

function membershipConflict(
  observationId: string,
  winner: string,
  attempted: string,
): Error {
  return new Error(
    `Canonical vacancy membership integrity error: SourceObservation "${observationId}" belongs to "${winner}" and cannot join "${attempted}".`,
  );
}

function identityConflict(
  provider: string,
  externalId: string,
  winner: string,
  attempted: string,
): Error {
  return new Error(
    `Canonical vacancy identity integrity error: provider "${normalizeVacancyProviderNamespace(provider)}" and external ID "${externalId}" belong to "${winner}" and cannot join "${attempted}".`,
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value));
}
