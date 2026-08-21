import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerClusterAssignmentPolicy } from "../../domain/recognition/EmployerClusterAssignmentPolicy.js";
import type { EmployerClusterDecision } from "../../domain/recognition/EmployerClusterDecision.js";
import type { EmployerClusterMatcher } from "../../domain/recognition/EmployerClusterMatcher.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import { decideEmployerClusterAssignment } from "../../domain/recognition/decideEmployerClusterAssignment.js";
import { recordObservationClusterAssignment } from "./recordObservationClusterAssignment.js";

export interface EvaluateObservationEmployerClusterDependencies {
  readonly clusterRepository: EmployerClusterRepository;
  readonly assignmentRepository: ObservationClusterAssignmentRepository;
  readonly matcher: EmployerClusterMatcher;
  readonly policy: EmployerClusterAssignmentPolicy;
  readonly algorithm: string;
  readonly algorithmVersion: string;
  readonly now?: () => Date;
  readonly generateAssignmentId?: () => string;
}

export async function evaluateObservationEmployerCluster(
  observation: SourceObservation,
  dependencies: EvaluateObservationEmployerClusterDependencies,
): Promise<EmployerClusterDecision> {
  const criteria = {
    ...(observation.locationText !== undefined
      ? { locationHint: observation.locationText }
      : {}),
    ...(observation.displayedCompanyName !== undefined
      ? { displayedCompanyNameHint: observation.displayedCompanyName }
      : {}),
  };
  const candidates =
    await dependencies.clusterRepository.findCandidates(criteria);
  const match = await dependencies.matcher.findBestMatch(
    observation,
    candidates,
  );
  const decision = decideEmployerClusterAssignment(
    match,
    dependencies.policy,
  );

  if (decision.outcome !== "NO_MATCH") {
    const cluster =
      decision.outcome === "AUTO_MATCH"
        ? decision.cluster
        : decision.candidateCluster;

    await recordObservationClusterAssignment(
      {
        sourceObservationId: observation.id,
        employerClusterId: cluster.id,
        confidence: decision.confidence,
        status:
          decision.outcome === "AUTO_MATCH" ? "ACCEPTED" : "PROPOSED",
        algorithm: dependencies.algorithm,
        algorithmVersion: dependencies.algorithmVersion,
        ...(decision.explanation !== undefined
          ? { explanation: decision.explanation }
          : {}),
      },
      {
        repository: dependencies.assignmentRepository,
        ...(dependencies.now !== undefined ? { now: dependencies.now } : {}),
        ...(dependencies.generateAssignmentId !== undefined
          ? { generateId: dependencies.generateAssignmentId }
          : {}),
      },
    );
  }

  return decision;
}
