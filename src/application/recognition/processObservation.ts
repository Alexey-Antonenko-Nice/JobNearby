import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
import type { EmployerRecognitionPersistence } from "../../domain/recognition/EmployerRecognitionPersistence.js";
import { EffectiveAssignmentConflictError } from "../../domain/recognition/EmployerRecognitionPersistenceError.js";
import { createEmployerCluster } from "./createEmployerCluster.js";
import { createObservationClusterAssignment } from "./createObservationClusterAssignment.js";
import {
  evaluateObservationEmployerCluster,
  type EvaluateObservationEmployerClusterDependencies,
} from "./evaluateObservationEmployerCluster.js";
import { loadEffectiveEmployerMembership } from "./loadEffectiveEmployerMembership.js";

export {
  evaluateObservationEmployerCluster,
  type EvaluateObservationEmployerClusterDependencies,
} from "./evaluateObservationEmployerCluster.js";

export type ProcessObservationResult =
  | {
      readonly outcome: "MATCHED_EXISTING_CLUSTER";
      readonly employerCluster: EmployerCluster;
      readonly assignment: ObservationClusterAssignment;
    }
  | {
      readonly outcome: "REVIEW_REQUIRED";
      readonly candidateCluster: EmployerCluster;
      readonly proposal: ObservationClusterAssignment;
      readonly confidence: number;
      readonly explanation?: string;
    }
  | {
      readonly outcome: "CREATED_NEW_CLUSTER";
      readonly employerCluster: EmployerCluster;
      readonly assignment: ObservationClusterAssignment;
    };

export interface ProcessObservationDependencies
  extends EvaluateObservationEmployerClusterDependencies {
  readonly recognitionPersistence: EmployerRecognitionPersistence;
  readonly generateClusterId?: () => string;
}

export async function processObservation(
  observation: SourceObservation,
  dependencies: ProcessObservationDependencies,
): Promise<ProcessObservationResult> {
  const existingMembership = await loadEffectiveEmployerMembership(
    observation.id,
    dependencies,
  );
  if (existingMembership !== null) {
    return {
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: existingMembership.cluster,
      assignment: existingMembership.assignment,
    };
  }

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
      ...(evaluation.explanation !== undefined
        ? { explanation: evaluation.explanation }
        : {}),
    };
  }

  const location = observation.locationText?.trim();
  const hasLocation = location !== undefined && location.length > 0;
  const employerCluster = createEmployerCluster(
    {
      status: "UNRESOLVED",
      displayLabel: hasLocation
        ? `Unknown employer — ${location}`
        : "Unknown employer",
      ...(hasLocation ? { primaryLocationHint: location } : {}),
    },
    {
      ...(dependencies.now !== undefined ? { now: dependencies.now } : {}),
      ...(dependencies.generateClusterId !== undefined
        ? { generateId: dependencies.generateClusterId }
        : {}),
    },
  );

  const assignment = createObservationClusterAssignment(
    {
      sourceObservationId: observation.id,
      employerClusterId: employerCluster.id,
      status: "ACCEPTED",
      confidence: 1,
      algorithm: "new-employer-cluster",
      algorithmVersion: "0.1.0",
      explanation:
        "New unresolved employer cluster created for this observation.",
    },
    {
      ...(dependencies.now !== undefined ? { now: dependencies.now } : {}),
      ...(dependencies.generateAssignmentId !== undefined
        ? { generateId: dependencies.generateAssignmentId }
        : {}),
    },
  );

  try {
    await dependencies.recognitionPersistence.saveNewClusterWithAssignment(
      employerCluster,
      assignment,
    );
  } catch (error) {
    if (!(error instanceof EffectiveAssignmentConflictError)) throw error;
    const winningMembership = await loadEffectiveEmployerMembership(
      observation.id,
      dependencies,
    );
    if (winningMembership === null) throw error;
    return {
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: winningMembership.cluster,
      assignment: winningMembership.assignment,
    };
  }

  return {
    outcome: "CREATED_NEW_CLUSTER",
    employerCluster,
    assignment,
  };
}
