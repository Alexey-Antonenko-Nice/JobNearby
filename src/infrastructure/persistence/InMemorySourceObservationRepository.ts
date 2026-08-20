import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";

import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";

export class InMemorySourceObservationRepository
  implements SourceObservationRepository
{
  private readonly observations = new Map<
    SourceObservationId,
    SourceObservation
  >();

  async save(observation: SourceObservation): Promise<void> {
    if (this.observations.has(observation.id)) {
      throw new Error(
        `SourceObservation with id "${observation.id}" already exists.`,
      );
    }

    this.observations.set(observation.id, observation);
  }

  async findById(
    id: SourceObservationId,
  ): Promise<SourceObservation | null> {
    return this.observations.get(id) ?? null;
  }
}
