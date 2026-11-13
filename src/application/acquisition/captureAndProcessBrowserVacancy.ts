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
import type { AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { assessBrowserVacancyCapture, type VacancyCaptureRejectionReason } from "./assessBrowserVacancyCapture.js";
import { createVacancyEvidenceExtractor } from "../evidence/createVacancyEvidenceExtractor.js";

export type CaptureEmployerStatus =
  | "MATCHED_EXISTING_RECORD"
  | "IDENTIFIED_NEW_RECORD"
  | "UNRESOLVED_RECORD_CREATED"
  | "UNRESOLVED_EXISTING_RECORD"
  | "NO_EMPLOYER_EVIDENCE"
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
        readonly captureAcceptedAsVacancy: true;
        readonly canonicalVacancyId: string;
        readonly vacancyOutcome: "CREATED" | "UPDATED_EXISTING";
        readonly observationAdded: boolean;
        readonly canonicalizationStatus: "USABLE" | "PARTIAL" | "CONFLICTED";
        readonly employerStatus: CaptureEmployerStatus;
        readonly employerDisplayName?: string;
      };
    }
  | {
      readonly capture: CaptureSummary;
      readonly processing: {
        readonly status: "VACANCY_NOT_DETECTED";
        readonly captureAcceptedAsVacancy: false;
        readonly rejectionReason: VacancyCaptureRejectionReason;
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
  readonly processPartialRecapture?: (
    sourceObservationId: string,
    providerNamespace: string,
    externalId: string,
    selectedContext: AcquisitionContext,
  ) => Promise<ProcessVacancyObservationResult | null>;
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
    const observation = await dependencies.ingestion.repository.findById(ingestion.sourceObservationId);
    if (observation === null) throw new Error("Persisted browser capture was not found.");
    const acceptance = await assessBrowserVacancyCapture(observation, createVacancyEvidenceExtractor());
    if (!acceptance.captureAcceptedAsVacancy) {
      if (acceptance.partialRecaptureIdentity !== undefined &&
        dependencies.processPartialRecapture !== undefined) {
        const partial = acceptance.partialRecaptureIdentity;
        const processing = await dependencies.processPartialRecapture(
          acceptance.sourceObservationId,
          partial.providerNamespace,
          partial.externalId,
          partial.selectedContext,
        );
        if (processing !== null) return processedCapture(capture, processing);
      }
      return { capture, processing: {
        status: "VACANCY_NOT_DETECTED",
        captureAcceptedAsVacancy: false,
        rejectionReason: acceptance.rejectionReason,
      } };
    }
    // Snapshot reuse only deduplicates immutable source content. Always reproject
    // the returned observation with current extractors, including exact recaptures.
    const processing = await dependencies.processVacancyObservation(
      acceptance.sourceObservationId,
    );
    return processedCapture(capture, processing);
  } catch (error) {
    dependencies.onProcessingFailure?.(ingestion.sourceObservationId, error);
    return { capture, processing: { status: "FAILED" } };
  }
}

function processedCapture(
  capture: CaptureSummary,
  processing: ProcessVacancyObservationResult,
): CaptureAndProcessBrowserVacancyResult {
  return {
    capture,
    processing: {
      status: "PROCESSED",
      captureAcceptedAsVacancy: true,
      canonicalVacancyId: processing.canonicalVacancyId,
      vacancyOutcome: processing.canonicalVacancyOutcome,
      observationAdded: processing.observationAdded,
      canonicalizationStatus: processing.canonicalizationStatus,
      ...mapEmployerFeedback(processing.employer),
    },
  };
}

function captureSummary(result: BrowserCaptureIngestionResult): CaptureSummary {
  return {
    observationId: result.sourceObservationId,
    acquisitionId: result.acquisitionId,
    observedAt: new Date(result.observedAt.getTime()),
  };
}

function mapEmployerFeedback(
  employer: EmployerProcessingSummary,
): { readonly employerStatus: CaptureEmployerStatus; readonly employerDisplayName?: string } {
  if (employer.outcome === "NO_EMPLOYER_EVIDENCE") {
    return { employerStatus: "NO_EMPLOYER_EVIDENCE" };
  }
  if (employer.outcome === "MATCHED_EXISTING_CLUSTER") {
    if (employer.employerClusterStatus === "CONFLICTED") return { employerStatus: "REVIEW_REQUIRED" };
    return employer.employerClusterStatus === "UNRESOLVED"
      ? { employerStatus: "UNRESOLVED_EXISTING_RECORD" }
      : { employerStatus: "MATCHED_EXISTING_RECORD" };
  }
  if (employer.outcome === "REVIEW_REQUIRED") {
    return { employerStatus: "REVIEW_REQUIRED" };
  }
  const displayName = usableEmployerDisplayName(employer.employerDisplayLabel);
  return employer.employerClusterStatus === "PROBABLY_RESOLVED" && displayName !== undefined
    ? { employerStatus: "IDENTIFIED_NEW_RECORD", employerDisplayName: displayName }
    : { employerStatus: "UNRESOLVED_RECORD_CREATED" };
}

function usableEmployerDisplayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = value.trim();
  return name.length === 0 || /^unknown\s+employer(?:\s*[—-].*)?$/iu.test(name)
    ? undefined
    : name;
}
