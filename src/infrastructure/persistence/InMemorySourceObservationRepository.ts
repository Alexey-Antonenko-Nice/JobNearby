import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";

import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { BrowserCaptureOccurrence, BrowserCaptureSnapshotRepository } from "../../domain/capture/SourceObservationRepository.js";

export class InMemorySourceObservationRepository
  implements BrowserCaptureSnapshotRepository
{
  private readonly observations = new Map<
    SourceObservationId,
    SourceObservation
  >();
  private readonly occurrences: BrowserCaptureOccurrence[] = [];

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

  async saveOrReuseBrowserSnapshot(observation: SourceObservation, occurrence: BrowserCaptureOccurrence) {
    const existing = [...this.observations.values()].find((candidate) =>
      candidate.source.sourceName === observation.source.sourceName &&
      candidate.source.externalId === observation.source.externalId &&
      candidate.contentFingerprint === observation.contentFingerprint &&
      candidate.source.externalId !== undefined && candidate.contentFingerprint !== undefined);
    const snapshot = existing ?? observation;
    if (existing === undefined) await this.save(observation);
    this.occurrences.push({ ...occurrence, capturedAt: new Date(occurrence.capturedAt) });
    return { sourceObservationId: snapshot.id, snapshotCreated: existing === undefined };
  }
}
