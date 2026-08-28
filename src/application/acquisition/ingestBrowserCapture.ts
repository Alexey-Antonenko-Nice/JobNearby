import { randomUUID } from "node:crypto";

import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { AcquisitionId } from "../../domain/acquisition/AcquisitionPackage.js";
import type { AcquisitionCaptureMapper } from "./AcquisitionCaptureMapper.js";
import type { BrowserCapturePayload } from "./BrowserCapturePayload.js";
import { BrowserCaptureAcquisitionAdapter } from "./BrowserCaptureAcquisitionAdapter.js";

export interface BrowserCaptureIngestionResult {
  readonly success: true;
  readonly sourceObservationId: SourceObservationId;
  readonly acquisitionId: AcquisitionId;
  readonly observedAt: Date;
}

export interface BrowserCaptureIngestionDependencies {
  readonly repository: SourceObservationRepository;
  readonly acquisitionMapper: AcquisitionCaptureMapper;
  readonly browserAdapter?: BrowserCaptureAcquisitionAdapter;
  readonly generateAcquisitionId?: () => AcquisitionId;
  readonly generateObservationId?: () => SourceObservationId;
}

export async function ingestBrowserCapture(
  payload: BrowserCapturePayload,
  dependencies: BrowserCaptureIngestionDependencies,
): Promise<BrowserCaptureIngestionResult> {
  const acquisitionId = (dependencies.generateAcquisitionId ?? randomUUID)();
  const observationId = (dependencies.generateObservationId ?? randomUUID)();
  const adapter = dependencies.browserAdapter ?? new BrowserCaptureAcquisitionAdapter();
  const acquisition = adapter.toAcquisitionPackage(payload, acquisitionId);
  const observation = dependencies.acquisitionMapper.toSourceObservation(
    acquisition,
    observationId,
  );

  try {
    await dependencies.repository.save(observation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown repository error.";
    throw new Error(`Browser capture could not be persisted: ${message}`, { cause: error });
  }

  return {
    success: true,
    sourceObservationId: observation.id,
    acquisitionId,
    observedAt: new Date(observation.observedAt.getTime()),
  };
}
