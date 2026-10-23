import type {
  SourceObservation,
  SourceObservationId,
} from "./SourceObservation.js";

export interface SourceObservationRepository {
  /** Capture sightings are separate from immutable observation snapshots. */
  countCaptureOccurrences?(ids: readonly SourceObservationId[]): Promise<number>;
  findByIds?(ids: readonly SourceObservationId[]): Promise<readonly SourceObservation[]>;
  /** Observations of a source that have no external ID and whose URL contains the fragment. */
  findUnidentifiedBySourceUrlFragment?(sourceName: string, fragment: string): Promise<readonly SourceObservation[]>;

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
