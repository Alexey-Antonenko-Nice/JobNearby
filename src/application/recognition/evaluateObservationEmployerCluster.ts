import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerClusterAssignmentPolicy } from "../../domain/recognition/EmployerClusterAssignmentPolicy.js";
import type { EmployerClusterDecision } from "../../domain/recognition/EmployerClusterDecision.js";
import type { EmployerClusterMatcher } from "../../domain/recognition/EmployerClusterMatcher.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
import {
  CurrentProposalConflictError,
  EffectiveAssignmentConflictError,
} from "../../domain/recognition/EmployerRecognitionPersistenceError.js";
import { decideEmployerClusterAssignment } from "../../domain/recognition/decideEmployerClusterAssignment.js";
import { recordObservationClusterAssignment } from "./recordObservationClusterAssignment.js";
import { createObservationClusterAssignment } from "./createObservationClusterAssignment.js";
import {
  loadEffectiveEmployerMembership,
  type EffectiveEmployerMembership,
} from "./loadEffectiveEmployerMembership.js";

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

export type EvaluateObservationEmployerClusterResult =
  | (Extract<EmployerClusterDecision, { outcome: "AUTO_MATCH" }> & {
      readonly assignment: ObservationClusterAssignment;
    })
  | (Extract<EmployerClusterDecision, { outcome: "REVIEW_REQUIRED" }> & {
      readonly proposal: ObservationClusterAssignment;
    })
  | Extract<EmployerClusterDecision, { outcome: "NO_MATCH" }>;

export async function evaluateObservationEmployerCluster(
  observation: SourceObservation,
  dependencies: EvaluateObservationEmployerClusterDependencies,
): Promise<EvaluateObservationEmployerClusterResult> {
  const existingMembership = await loadEffectiveEmployerMembership(
    observation.id,
    dependencies,
  );
  if (existingMembership !== null) {
    return effectiveMembershipResult(existingMembership);
  }

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

  if (decision.outcome === "AUTO_MATCH") {
    try {
      const assignment = await recordObservationClusterAssignment(
        {
          sourceObservationId: observation.id,
          employerClusterId: decision.cluster.id,
          confidence: decision.confidence,
          status: "ACCEPTED",
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
      return { ...decision, assignment };
    } catch (error) {
      if (!(error instanceof EffectiveAssignmentConflictError)) throw error;
      const winningMembership = await loadEffectiveEmployerMembership(
        observation.id,
        dependencies,
      );
      if (winningMembership === null) throw error;
      return effectiveMembershipResult(winningMembership);
    }
  }

  if (decision.outcome === "REVIEW_REQUIRED") {
    const winningMembership = await loadEffectiveEmployerMembership(
      observation.id,
      dependencies,
    );
    if (winningMembership !== null) {
      return effectiveMembershipResult(winningMembership);
    }

    const proposalInput = {
      sourceObservationId: observation.id,
      employerClusterId: decision.candidateCluster.id,
      confidence: decision.confidence,
      status: "PROPOSED" as const,
      algorithm: dependencies.algorithm,
      algorithmVersion: dependencies.algorithmVersion,
      ...(decision.explanation === undefined
        ? {}
        : { explanation: decision.explanation }),
    };
    const existingProposal =
      await dependencies.assignmentRepository.findCurrentProposalByObservationId(
        observation.id,
      );
    if (
      existingProposal !== null &&
      semanticallyEqualProposal(existingProposal, proposalInput)
    ) {
      return { ...decision, proposal: existingProposal };
    }

    const proposal = createObservationClusterAssignment(proposalInput, {
      ...(dependencies.now !== undefined ? { now: dependencies.now } : {}),
      ...(dependencies.generateAssignmentId !== undefined
        ? { generateId: dependencies.generateAssignmentId }
        : {}),
    });
    if (existingProposal !== null) {
      await dependencies.assignmentRepository.replaceCurrentProposal(
        existingProposal.id,
        proposal,
        proposal.evaluatedAt,
      );
      return { ...decision, proposal };
    }

    try {
      await dependencies.assignmentRepository.save(proposal);
      return { ...decision, proposal };
    } catch (error) {
      if (!(error instanceof CurrentProposalConflictError)) throw error;
      const concurrentProposal =
        await dependencies.assignmentRepository.findCurrentProposalByObservationId(
          observation.id,
        );
      if (concurrentProposal === null) throw error;
      if (semanticallyEqualProposal(concurrentProposal, proposalInput)) {
        return { ...decision, proposal: concurrentProposal };
      }
      await dependencies.assignmentRepository.replaceCurrentProposal(
        concurrentProposal.id,
        proposal,
        proposal.evaluatedAt,
      );
      return { ...decision, proposal };
    }
  }

  return decision;
}

function effectiveMembershipResult(
  membership: EffectiveEmployerMembership,
): Extract<EvaluateObservationEmployerClusterResult, { outcome: "AUTO_MATCH" }> {
  return {
    outcome: "AUTO_MATCH",
    cluster: membership.cluster,
    confidence: membership.assignment.confidence,
    assignment: membership.assignment,
    explanation:
      membership.assignment.status === "USER_CONFIRMED"
        ? "Existing user-confirmed employer membership preserved."
        : "Existing accepted employer membership preserved.",
  };
}

function semanticallyEqualProposal(
  existing: ObservationClusterAssignment,
  candidate: {
    readonly sourceObservationId: string;
    readonly employerClusterId: string;
    readonly confidence: number;
    readonly algorithm: string;
    readonly algorithmVersion: string;
    readonly explanation?: string;
  },
): boolean {
  return (
    existing.status === "PROPOSED" &&
    existing.sourceObservationId === candidate.sourceObservationId &&
    existing.employerClusterId === candidate.employerClusterId &&
    existing.confidence === candidate.confidence &&
    existing.algorithm === candidate.algorithm.trim() &&
    existing.algorithmVersion === candidate.algorithmVersion.trim() &&
    existing.explanation === normalizeExplanation(candidate.explanation)
  );
}

function normalizeExplanation(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
