import { randomUUID } from "node:crypto";

import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type {
  EmployerCluster,
  EmployerClusterId,
  EmployerClusterStatus,
} from "../../domain/recognition/EmployerCluster.js";
import type {
  CanonicalVacancy,
  CanonicalVacancyId,
  CanonicalizationStatus,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
import {
  processObservation,
  type ProcessObservationDependencies,
  type ProcessObservationResult,
} from "../recognition/processObservation.js";
import type {
  ExistingPipelineCanonicalVacancyAdapter,
  ExistingPipelineCanonicalVacancyAdapterInput,
} from "./ExistingPipelineCanonicalVacancyAdapter.js";

const DEFAULT_DERIVATION_ALGORITHM = "process-vacancy-observation";
const DEFAULT_DERIVATION_ALGORITHM_VERSION = "0.1.0";

export class SourceObservationNotFoundError extends Error {
  constructor(sourceObservationId: SourceObservationId) {
    super(`SourceObservation "${sourceObservationId}" was not found.`);
    this.name = "SourceObservationNotFoundError";
  }
}

export class CanonicalVacancyIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalVacancyIntegrityError";
  }
}

export type EmployerProcessingSummary =
  | {
      readonly outcome: "MATCHED_EXISTING_CLUSTER";
      readonly employerClusterId: EmployerClusterId;
      readonly employerClusterStatus: EmployerClusterStatus;
    }
  | {
      readonly outcome: "CREATED_NEW_CLUSTER";
      readonly employerClusterId: EmployerClusterId;
      readonly employerClusterStatus: EmployerClusterStatus;
    }
  | {
      readonly outcome: "REVIEW_REQUIRED";
      readonly candidateClusterId: EmployerClusterId;
      readonly confidence: number;
    };

export interface ProcessVacancyObservationResult {
  readonly sourceObservationId: SourceObservationId;
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly canonicalVacancyOutcome: "CREATED" | "UPDATED_EXISTING";
  readonly observationAdded: boolean;
  readonly canonicalizationStatus: CanonicalizationStatus;
  readonly employer: EmployerProcessingSummary;
}

interface CanonicalVacancyAdapter {
  canonicalize(input: ExistingPipelineCanonicalVacancyAdapterInput): CanonicalVacancy;
}

export interface ProcessVacancyObservationDependencies {
  readonly sourceObservationRepository: SourceObservationRepository;
  readonly canonicalVacancyRepository: CanonicalVacancyRepository;
  readonly evidenceExtractor: VacancyEvidenceExtractor;
  readonly canonicalVacancyAdapter:
    | ExistingPipelineCanonicalVacancyAdapter
    | CanonicalVacancyAdapter;
  readonly employerRecognition: ProcessObservationDependencies;
  readonly generateCanonicalVacancyId?: () => CanonicalVacancyId;
  readonly now?: () => Date;
  readonly derivationAlgorithm?: string;
  readonly derivationAlgorithmVersion?: string;
  readonly processEmployerObservation?: typeof processObservation;
}

export async function processVacancyObservation(
  sourceObservationId: SourceObservationId,
  dependencies: ProcessVacancyObservationDependencies,
): Promise<ProcessVacancyObservationResult> {
  const requestedObservation =
    await dependencies.sourceObservationRepository.findById(sourceObservationId);
  if (requestedObservation === null) {
    throw new SourceObservationNotFoundError(sourceObservationId);
  }

  const proposedCanonicalVacancyId =
    (dependencies.generateCanonicalVacancyId ?? randomUUID)();
  const claim = await dependencies.canonicalVacancyRepository.claimIdentity(
    sourceObservationId,
    proposedCanonicalVacancyId,
  );
  const existingCanonical =
    await dependencies.canonicalVacancyRepository.findById(
      claim.canonicalVacancyId,
    );
  const observationAdded =
    existingCanonical === null ||
    !existingCanonical.sourceObservationIds.includes(sourceObservationId);
  const observationIds = existingCanonical === null
    ? [sourceObservationId]
    : observationAdded
      ? [...existingCanonical.sourceObservationIds, sourceObservationId]
      : [...existingCanonical.sourceObservationIds];
  const observations = await loadObservationHistory(
    observationIds,
    requestedObservation,
    dependencies.sourceObservationRepository,
  );
  const extractedEvidence = await Promise.all(
    observations.map((observation) =>
      dependencies.evidenceExtractor.extract(observation)),
  );

  const employerResult = await (
    dependencies.processEmployerObservation ?? processObservation
  )(requestedObservation, dependencies.employerRecognition);
  const employerCluster = await resolveCanonicalEmployerCluster(
    observationIds,
    dependencies.employerRecognition,
  );
  const derivation = {
    algorithm:
      dependencies.derivationAlgorithm ?? DEFAULT_DERIVATION_ALGORITHM,
    algorithmVersion:
      dependencies.derivationAlgorithmVersion ??
      DEFAULT_DERIVATION_ALGORITHM_VERSION,
    derivedAt: new Date((dependencies.now ?? (() => new Date()))().getTime()),
  };
  const canonicalVacancy = dependencies.canonicalVacancyAdapter.canonicalize({
    canonicalVacancyId: claim.canonicalVacancyId,
    observations,
    extractedEvidence,
    ...(employerCluster === null ? {} : { employerCluster }),
    derivation,
  });
  await dependencies.canonicalVacancyRepository.save(canonicalVacancy);

  return {
    sourceObservationId,
    canonicalVacancyId: claim.canonicalVacancyId,
    canonicalVacancyOutcome:
      existingCanonical === null ? "CREATED" : "UPDATED_EXISTING",
    observationAdded,
    canonicalizationStatus: canonicalVacancy.canonicalizationStatus,
    employer: summarizeEmployerResult(employerResult),
  };
}

export async function resolveCanonicalEmployerCluster(
  sourceObservationIds: readonly SourceObservationId[],
  dependencies: Pick<
    ProcessObservationDependencies,
    "assignmentRepository" | "clusterRepository"
  >,
): Promise<EmployerCluster | null> {
  const effectiveAssignments = (
    await Promise.all(
      sourceObservationIds.map((sourceObservationId) =>
        dependencies.assignmentRepository.findEffectiveByObservationId(
          sourceObservationId,
        )),
    )
  ).filter((assignment) => assignment !== null);
  const clusterIds = [
    ...new Set(
      effectiveAssignments.map(({ employerClusterId }) => employerClusterId),
    ),
  ];
  if (clusterIds.length === 0) return null;
  if (clusterIds.length > 1) {
    throw new CanonicalVacancyIntegrityError(
      `Canonical vacancy employer integrity error: observation history has effective memberships in multiple EmployerClusters (${clusterIds.join(", ")}).`,
    );
  }
  const clusterId = clusterIds[0]!;
  const cluster = await dependencies.clusterRepository.findById(clusterId);
  if (cluster === null) {
    throw new CanonicalVacancyIntegrityError(
      `Canonical vacancy employer integrity error: effective assignment references missing EmployerCluster "${clusterId}".`,
    );
  }
  return cluster;
}

async function loadObservationHistory(
  sourceObservationIds: readonly SourceObservationId[],
  requestedObservation: SourceObservation,
  repository: SourceObservationRepository,
): Promise<SourceObservation[]> {
  return Promise.all(
    sourceObservationIds.map(async (sourceObservationId) => {
      if (sourceObservationId === requestedObservation.id) {
        return requestedObservation;
      }
      const observation = await repository.findById(sourceObservationId);
      if (observation === null) {
        throw new CanonicalVacancyIntegrityError(
          `Canonical vacancy history references missing SourceObservation "${sourceObservationId}".`,
        );
      }
      return observation;
    }),
  );
}

function summarizeEmployerResult(
  result: ProcessObservationResult,
): EmployerProcessingSummary {
  if (result.outcome === "REVIEW_REQUIRED") {
    return {
      outcome: result.outcome,
      candidateClusterId: result.candidateCluster.id,
      confidence: result.confidence,
    };
  }
  return {
    outcome: result.outcome,
    employerClusterId: result.employerCluster.id,
    employerClusterStatus: result.employerCluster.status,
  };
}
