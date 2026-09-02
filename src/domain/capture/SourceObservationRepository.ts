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

export interface BrowserCaptureOccurrence {
  readonly id: string;
  readonly capturedAt: Date;
  readonly capturedUrl: string;
}

export interface BrowserCaptureSnapshotRepository extends SourceObservationRepository {
  saveOrReuseBrowserSnapshot(
    observation: SourceObservation,
    occurrence: BrowserCaptureOccurrence,
  ): Promise<{ readonly sourceObservationId: SourceObservationId; readonly snapshotCreated: boolean }>;
}
