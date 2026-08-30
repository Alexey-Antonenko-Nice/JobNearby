import type { BrowserCapturePayload } from "./BrowserCapturePayload.js";
import {
  ingestBrowserCapture,
  type BrowserCaptureIngestionDependencies,
  type BrowserCaptureIngestionResult,
} from "./ingestBrowserCapture.js";
import type {
  EmployerProcessingSummary,
  ProcessVacancyObservationResult,
} from "../vacancies/processVacancyObservation.js";

export type CaptureEmployerStatus =
  | "MATCHED_EXISTING_RECORD"
  | "UNRESOLVED_RECORD_CREATED"
  | "REVIEW_REQUIRED";

interface CaptureSummary {
  readonly observationId: string;
  readonly acquisitionId: string;
  readonly observedAt: Date;
}

export type CaptureAndProcessBrowserVacancyResult =
  | {
      readonly capture: CaptureSummary;
      readonly processing: {
        readonly status: "PROCESSED";
        readonly canonicalVacancyId: string;
        readonly vacancyOutcome: "CREATED" | "UPDATED_EXISTING";
        readonly observationAdded: boolean;
        readonly canonicalizationStatus: "USABLE" | "PARTIAL" | "CONFLICTED";
        readonly employerStatus: CaptureEmployerStatus;
      };
    }
  | {
      readonly capture: CaptureSummary;
      readonly processing: {
        readonly status: "FAILED";
      };
    };

export interface CaptureAndProcessBrowserVacancyDependencies {
  readonly ingestion: BrowserCaptureIngestionDependencies;
  readonly processVacancyObservation: (
    sourceObservationId: string,
  ) => Promise<ProcessVacancyObservationResult>;
  readonly onProcessingFailure?: (
    sourceObservationId: string,
    error: unknown,
  ) => void;
}

export async function captureAndProcessBrowserVacancy(
  payload: BrowserCapturePayload,
  dependencies: CaptureAndProcessBrowserVacancyDependencies,
): Promise<CaptureAndProcessBrowserVacancyResult> {
  const ingestion = await ingestBrowserCapture(payload, dependencies.ingestion);
  const capture = captureSummary(ingestion);
  try {
    const processing = await dependencies.processVacancyObservation(
      ingestion.sourceObservationId,
    );
    return {
      capture,
      processing: {
        status: "PROCESSED",
        canonicalVacancyId: processing.canonicalVacancyId,
        vacancyOutcome: processing.canonicalVacancyOutcome,
        observationAdded: processing.observationAdded,
        canonicalizationStatus: processing.canonicalizationStatus,
        employerStatus: mapEmployerStatus(processing.employer),
      },
    };
  } catch (error) {
    dependencies.onProcessingFailure?.(ingestion.sourceObservationId, error);
    return { capture, processing: { status: "FAILED" } };
  }
}

function captureSummary(result: BrowserCaptureIngestionResult): CaptureSummary {
  return {
    observationId: result.sourceObservationId,
    acquisitionId: result.acquisitionId,
    observedAt: new Date(result.observedAt.getTime()),
  };
}

function mapEmployerStatus(
  employer: EmployerProcessingSummary,
): CaptureEmployerStatus {
  return {
    MATCHED_EXISTING_CLUSTER: "MATCHED_EXISTING_RECORD",
    CREATED_NEW_CLUSTER: "UNRESOLVED_RECORD_CREATED",
    REVIEW_REQUIRED: "REVIEW_REQUIRED",
  }[employer.outcome] as CaptureEmployerStatus;
}
