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
import { CanonicalVacancyStaleProjectionError } from "../../domain/vacancies/CanonicalVacancyPersistenceError.js";
import {
  evaluateObservationEmployerCluster,
  processObservation,
  type ProcessObservationDependencies,
  type ProcessObservationResult,
} from "../recognition/processObservation.js";
import { recordObservationClusterAssignment } from "../recognition/recordObservationClusterAssignment.js";
import { EffectiveAssignmentConflictError } from "../../domain/recognition/EmployerRecognitionPersistenceError.js";
import type {
  ExistingPipelineCanonicalVacancyAdapter,
  ExistingPipelineCanonicalVacancyAdapterInput,
} from "./ExistingPipelineCanonicalVacancyAdapter.js";

const DEFAULT_DERIVATION_ALGORITHM = "process-vacancy-observation";
const DEFAULT_DERIVATION_ALGORITHM_VERSION = "0.1.0";
const EMPLOYER_CONTINUITY_ALGORITHM = "canonical-vacancy-employer-continuity";
const EMPLOYER_CONTINUITY_ALGORITHM_VERSION = "0.1.0";

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

export class CanonicalVacancyConcurrencyError extends Error {
  constructor(
    readonly canonicalVacancyId: CanonicalVacancyId,
    readonly attempts: number,
  ) {
    super(
      `Canonical vacancy "${canonicalVacancyId}" remained stale after ${attempts} projection attempts.`,
    );
    this.name = "CanonicalVacancyConcurrencyError";
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
  readonly maximumProjectionAttempts?: number;
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
  const maximumAttempts = dependencies.maximumProjectionAttempts ?? 3;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("maximumProjectionAttempts must be a positive integer.");
  }

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const basis = await loadCanonicalProjectionBasis(
        claim.canonicalVacancyId,
        requestedObservation,
        dependencies,
      );
      const extractedEvidence = await Promise.all(
        basis.observations.map((observation) =>
          dependencies.evidenceExtractor.extract(observation)),
      );
      const establishedEmployerCluster = await resolveCanonicalEmployerCluster(
        basis.observationIds.filter((id) => id !== requestedObservation.id),
        dependencies.employerRecognition,
      );
      const employerResult = establishedEmployerCluster === null ||
          dependencies.processEmployerObservation !== undefined
        ? await (
          dependencies.processEmployerObservation ?? processObservation
        )(requestedObservation, dependencies.employerRecognition)
        : await processEmployerObservationWithCanonicalContinuity(
          requestedObservation,
          establishedEmployerCluster,
          dependencies.employerRecognition,
        );
      const employerCluster = await resolveCanonicalEmployerCluster(
        basis.observationIds,
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
        observations: basis.observations,
        extractedEvidence,
        ...(employerCluster === null ? {} : { employerCluster }),
        derivation,
      });
      const saveResult =
        await dependencies.canonicalVacancyRepository.save(canonicalVacancy);
      return {
        sourceObservationId,
        canonicalVacancyId: claim.canonicalVacancyId,
        canonicalVacancyOutcome: saveResult.outcome,
        observationAdded: basis.observationAdded,
        canonicalizationStatus: canonicalVacancy.canonicalizationStatus,
        employer: summarizeEmployerResult(employerResult),
      };
    } catch (error) {
      if (!(error instanceof CanonicalVacancyStaleProjectionError)) throw error;
      if (attempt === maximumAttempts) {
        throw new CanonicalVacancyConcurrencyError(
          claim.canonicalVacancyId,
          maximumAttempts,
        );
      }
    }
  }
  throw new CanonicalVacancyConcurrencyError(
    claim.canonicalVacancyId,
    maximumAttempts,
  );
}

async function processEmployerObservationWithCanonicalContinuity(
  observation: SourceObservation,
  establishedEmployerCluster: EmployerCluster,
  dependencies: ProcessObservationDependencies,
): Promise<ProcessObservationResult> {
  const evaluation = await evaluateObservationEmployerCluster(
    observation,
    dependencies,
  );
  if (evaluation.outcome === "AUTO_MATCH") {
    return {
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: evaluation.cluster,
      assignment: evaluation.assignment,
    };
  }
  if (evaluation.outcome === "REVIEW_REQUIRED") {
    return {
      outcome: "REVIEW_REQUIRED",
      candidateCluster: evaluation.candidateCluster,
      proposal: evaluation.proposal,
      confidence: evaluation.confidence,
      ...(evaluation.explanation === undefined
        ? {}
        : { explanation: evaluation.explanation }),
    };
  }

  const assignment = await recordCanonicalEmployerContinuity(
    observation.id,
    establishedEmployerCluster,
    dependencies,
  );
  return {
    outcome: "MATCHED_EXISTING_CLUSTER",
    employerCluster: establishedEmployerCluster,
    assignment,
  };
}

async function recordCanonicalEmployerContinuity(
  sourceObservationId: SourceObservationId,
  employerCluster: EmployerCluster,
  dependencies: ProcessObservationDependencies,
) {
  const existing = await dependencies.assignmentRepository
    .findEffectiveByObservationId(sourceObservationId);
  if (existing !== null) {
    if (existing.employerClusterId !== employerCluster.id) {
      throw new CanonicalVacancyIntegrityError(
        `Canonical vacancy employer integrity error: observation "${sourceObservationId}" already has an effective membership in EmployerCluster "${existing.employerClusterId}".`,
      );
    }
    return existing;
  }

  try {
    return await recordObservationClusterAssignment(
      {
        sourceObservationId,
        employerClusterId: employerCluster.id,
        confidence: 1,
        status: "ACCEPTED",
        algorithm: EMPLOYER_CONTINUITY_ALGORITHM,
        algorithmVersion: EMPLOYER_CONTINUITY_ALGORITHM_VERSION,
        explanation:
          "Employer membership inherited from canonical vacancy history after no evidence-based match.",
      },
      {
        repository: dependencies.assignmentRepository,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        ...(dependencies.generateAssignmentId === undefined
          ? {}
          : { generateId: dependencies.generateAssignmentId }),
      },
    );
  } catch (error) {
    if (!(error instanceof EffectiveAssignmentConflictError)) throw error;
    const winningAssignment = await dependencies.assignmentRepository
      .findEffectiveByObservationId(sourceObservationId);
    if (winningAssignment === null) throw error;
    if (winningAssignment.employerClusterId !== employerCluster.id) {
      throw new CanonicalVacancyIntegrityError(
        `Canonical vacancy employer integrity error: observation "${sourceObservationId}" concurrently received an effective membership in EmployerCluster "${winningAssignment.employerClusterId}".`,
      );
    }
    return winningAssignment;
  }
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

async function loadCanonicalProjectionBasis(
  canonicalVacancyId: CanonicalVacancyId,
  requestedObservation: SourceObservation,
  dependencies: Pick<
    ProcessVacancyObservationDependencies,
    "canonicalVacancyRepository" | "sourceObservationRepository"
  >,
): Promise<{
  readonly observationIds: readonly SourceObservationId[];
  readonly observations: readonly SourceObservation[];
  readonly observationAdded: boolean;
}> {
  const [projection, claimedIds] = await Promise.all([
    dependencies.canonicalVacancyRepository.findById(canonicalVacancyId),
    dependencies.canonicalVacancyRepository.findClaimedSourceObservationIds(
      canonicalVacancyId,
    ),
  ]);
  const claimSet = new Set(claimedIds);
  for (const projectedId of projection?.sourceObservationIds ?? []) {
    if (!claimSet.has(projectedId)) {
      throw new CanonicalVacancyIntegrityError(
        `Canonical vacancy "${canonicalVacancyId}" contains SourceObservation "${projectedId}" without an authoritative claim.`,
      );
    }
  }
  if (!claimSet.has(requestedObservation.id)) {
    throw new CanonicalVacancyIntegrityError(
      `Canonical vacancy "${canonicalVacancyId}" is missing the requested observation claim "${requestedObservation.id}".`,
    );
  }
  const observations = new Map<SourceObservationId, SourceObservation>();
  await Promise.all(claimedIds.map(async (claimedId) => {
    const observation = claimedId === requestedObservation.id
      ? requestedObservation
      : await dependencies.sourceObservationRepository.findById(claimedId);
    if (observation === null) {
      throw new CanonicalVacancyIntegrityError(
        `Canonical vacancy history references missing SourceObservation "${claimedId}".`,
      );
    }
    observations.set(claimedId, observation);
  }));
  const projectedIds = projection?.sourceObservationIds ?? [];
  const projectedSet = new Set(projectedIds);
  const appendedIds = claimedIds
    .filter((claimedId) => !projectedSet.has(claimedId))
    .sort((left, right) => compareObservations(
      observations.get(left)!,
      observations.get(right)!,
    ));
  const observationIds = [...projectedIds, ...appendedIds];
  return {
    observationIds,
    observations: observationIds.map((id) => observations.get(id)!),
    observationAdded:
      projection === null || !projectedSet.has(requestedObservation.id),
  };
}

function compareObservations(
  left: SourceObservation,
  right: SourceObservation,
): number {
  return left.observedAt.getTime() - right.observedAt.getTime() ||
    left.id.localeCompare(right.id);
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
