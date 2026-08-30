import type Database from "better-sqlite3";

import { BrowserCaptureAcquisitionAdapter } from "../../application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import {
  captureAndProcessBrowserVacancy,
  type CaptureAndProcessBrowserVacancyResult,
} from "../../application/acquisition/captureAndProcessBrowserVacancy.js";
import type { BrowserCapturePayload } from "../../application/acquisition/BrowserCapturePayload.js";
import { DeterministicAcquisitionCaptureMapper } from "../../application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { CompositeVacancyEvidenceExtractor } from "../../application/evidence/CompositeVacancyEvidenceExtractor.js";
import { DirectFieldVacancyEvidenceExtractor } from "../../application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { ExplicitEmployerCharacteristicExtractor } from "../../application/evidence/ExplicitEmployerCharacteristicExtractor.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { EvidenceBasedEmployerClusterMatcher } from "../../application/recognition/EvidenceBasedEmployerClusterMatcher.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { processVacancyObservation } from "../../application/vacancies/processVacancyObservation.js";
import { DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY } from "../../domain/recognition/EmployerClusterAssignmentPolicy.js";
import { SqliteCanonicalVacancyRepository } from "../persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerClusterObservationProvider } from "../persistence/SqliteEmployerClusterObservationProvider.js";
import { SqliteEmployerClusterRepository } from "../persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerRecognitionPersistence } from "../persistence/SqliteEmployerRecognitionPersistence.js";
import { SqliteObservationClusterAssignmentRepository } from "../persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../persistence/SqliteSourceObservationRepository.js";

export interface CaptureProcessingRuntime {
  captureAndProcessBrowserVacancy(
    payload: BrowserCapturePayload,
  ): Promise<CaptureAndProcessBrowserVacancyResult>;
}

export interface CaptureProcessingRuntimeOptions {
  readonly onProcessingFailure?: (
    sourceObservationId: string,
    error: unknown,
  ) => void;
}

export function createCaptureProcessingRuntime(
  database: Database.Database,
  options: CaptureProcessingRuntimeOptions = {},
): CaptureProcessingRuntime {
  const sourceObservationRepository =
    new SqliteSourceObservationRepository(database);
  const canonicalVacancyRepository =
    new SqliteCanonicalVacancyRepository(database);
  const employerClusterRepository =
    new SqliteEmployerClusterRepository(database);
  const assignmentRepository =
    new SqliteObservationClusterAssignmentRepository(database);
  const evidenceExtractor = new CompositeVacancyEvidenceExtractor([
    new DirectFieldVacancyEvidenceExtractor(),
    new ExplicitTextVacancyEvidenceExtractor(),
    new ExplicitEmployerCharacteristicExtractor(),
  ]);
  const matcher = new EvidenceBasedEmployerClusterMatcher({
    evidenceExtractor,
    observationProvider: new SqliteEmployerClusterObservationProvider(database),
  });
  const processingDependencies = {
    sourceObservationRepository,
    canonicalVacancyRepository,
    evidenceExtractor,
    canonicalVacancyAdapter: new ExistingPipelineCanonicalVacancyAdapter(
      new DeterministicCanonicalVacancyCanonicalizer(),
    ),
    employerRecognition: {
      clusterRepository: employerClusterRepository,
      assignmentRepository,
      matcher,
      policy: DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY,
      algorithm: "evidence-based-employer-cluster-matcher",
      algorithmVersion: "0.1.0",
      recognitionPersistence: new SqliteEmployerRecognitionPersistence(database),
    },
  };
  const ingestion = {
    repository: sourceObservationRepository,
    acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
    browserAdapter: new BrowserCaptureAcquisitionAdapter(),
  };

  return {
    captureAndProcessBrowserVacancy: (payload) =>
      captureAndProcessBrowserVacancy(payload, {
        ingestion,
        processVacancyObservation: (sourceObservationId) =>
          processVacancyObservation(sourceObservationId, processingDependencies),
        ...(options.onProcessingFailure === undefined
          ? {}
          : { onProcessingFailure: options.onProcessingFailure }),
      }),
  };
}
