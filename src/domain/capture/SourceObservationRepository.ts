import type {
  SourceObservation,
  SourceObservationId,
} from "./SourceObservation.js";

export interface SourceObservationRepository {
  save(observation: SourceObservation): Promise<void>;

  findById(
    id: SourceObservationId,
  ): Promise<SourceObservation | null>;
}
