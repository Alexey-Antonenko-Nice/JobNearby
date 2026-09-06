import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
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
  readonly evidenceExtractor?: VacancyEvidenceExtractor;
  readonly generateClusterId?: () => string;
}

export async function processObservation(
  observation: VacancyEvidenceExtractionInput,
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

  const propagated = await propagateConfirmedEmployerMemory(observation, dependencies);
  if (propagated !== null) return propagated;

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

  const explicitEmployerName = dependencies.evidenceExtractor === undefined
    ? undefined
    : await reliableExplicitEmployerName(observation, dependencies.evidenceExtractor);
  const location = observation.locationText?.trim();
  const hasLocation = location !== undefined && location.length > 0;
  const employerCluster = createEmployerCluster(
    {
      status: explicitEmployerName === undefined ? "UNRESOLVED" : "PROBABLY_RESOLVED",
      displayLabel: explicitEmployerName ?? (hasLocation ? `Unknown employer — ${location}` : "Unknown employer"),
      ...(explicitEmployerName === undefined && hasLocation ? { primaryLocationHint: location } : {}),
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
      explanation: explicitEmployerName === undefined
        ? "New unresolved employer cluster created for this observation."
        : "New employer cluster created from explicit employer evidence.",
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

async function propagateConfirmedEmployerMemory(
  observation: VacancyEvidenceExtractionInput,
  dependencies: ProcessObservationDependencies,
): Promise<ProcessObservationResult | null> {
  if (dependencies.evidenceExtractor === undefined || dependencies.assignmentRepository.findEffectiveByClusterId === undefined) return null;
  const evidence = await dependencies.evidenceExtractor.extract(observation);
  const organizations = evidence.organizations;
  const displayed = [...new Set(organizations.filter(({ role }) => role === "UNKNOWN").map(({ value }) => normalizeOrganizationEvidenceName(value)))];
  const employer = [...new Set(organizations.filter(({ role }) => role === "EMPLOYER").map(({ value }) => normalizeOrganizationEvidenceName(value)))];
  const candidates = [...new Set([...displayed, ...employer])];
  if (candidates.length !== 1) return null;
  if (organizations.some(({ role }) => role === "STAFFING_AGENCY" || role === "RECRUITER" || role === "CLIENT")) return null;
  if (organizations.some(({ role, value }) => role === "EMPLOYER" && normalizeOrganizationEvidenceName(value) !== candidates[0])) return null;

  const matchingClusters = new Map<string, EmployerCluster>();
  for (const name of candidates) {
    for (const cluster of await dependencies.clusterRepository.findCandidates({ displayedCompanyNameHint: name })) {
      if (cluster.status === "CONFLICTED" || cluster.displayLabel === undefined || normalizeOrganizationEvidenceName(cluster.displayLabel) !== name) continue;
      const assignments = await dependencies.assignmentRepository.findEffectiveByClusterId!(cluster.id);
      if (assignments.some(({ status }) => status === "USER_CONFIRMED")) matchingClusters.set(cluster.id, cluster);
    }
  }
  if (matchingClusters.size !== 1) return null;
  const cluster = [...matchingClusters.values()][0]!;
  const assignment = createObservationClusterAssignment({
    sourceObservationId: observation.id,
    employerClusterId: cluster.id,
    status: "ACCEPTED",
    confidence: 1,
    algorithm: "confirmed-employer-memory",
    algorithmVersion: "0.1.0",
    explanation: `Reused employer cluster from prior user-confirmed employer memory for matching organization "${cluster.displayLabel}".`,
  }, {
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    ...(dependencies.generateAssignmentId === undefined ? {} : { generateId: dependencies.generateAssignmentId }),
  });
  try {
    await dependencies.assignmentRepository.save(assignment);
  } catch (error) {
    if (!(error instanceof EffectiveAssignmentConflictError)) throw error;
    const winning = await loadEffectiveEmployerMembership(observation.id, dependencies);
    return winning === null ? null : { outcome: "MATCHED_EXISTING_CLUSTER", employerCluster: winning.cluster, assignment: winning.assignment };
  }
  return { outcome: "MATCHED_EXISTING_CLUSTER", employerCluster: cluster, assignment };
}

async function reliableExplicitEmployerName(
  observation: VacancyEvidenceExtractionInput,
  evidenceExtractor: VacancyEvidenceExtractor,
): Promise<string | undefined> {
  const names = new Map<string, string>();
  for (const evidence of (await evidenceExtractor.extract(observation)).organizations) {
    if (evidence.role !== "EMPLOYER" || evidence.provenance.confidence !== 1) continue;
    const value = evidence.value.trim();
    if (value.length > 0) names.set(normalizeOrganizationEvidenceName(value), value);
  }
  return names.size === 1 ? [...names.values()][0] : undefined;
}
