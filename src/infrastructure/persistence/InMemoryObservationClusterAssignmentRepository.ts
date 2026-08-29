import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
} from "../../domain/recognition/ObservationClusterAssignment.js";

import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";

export class InMemoryObservationClusterAssignmentRepository
  implements ObservationClusterAssignmentRepository
{
  private readonly assignments = new Map<
    ObservationClusterAssignmentId,
    ObservationClusterAssignment
  >();

  findEffectiveByClusterId(
    employerClusterId: EmployerClusterId,
  ): readonly ObservationClusterAssignment[] {
    return [...this.assignments.values()]
      .filter(
        (assignment) =>
          assignment.employerClusterId === employerClusterId &&
          isEffective(assignment),
      )
      .sort(compareAssignments)
      .map(clone);
  }

  async save(
    assignment: ObservationClusterAssignment,
  ): Promise<void> {
    if (this.assignments.has(assignment.id)) {
      throw new Error(
        `ObservationClusterAssignment with id "${assignment.id}" already exists.`,
      );
    }

    validateAssignment(assignment);
    enforceCurrentState(this.assignments.values(), assignment);
    this.assignments.set(assignment.id, clone(assignment));
  }

  async findById(
    id: ObservationClusterAssignmentId,
  ): Promise<ObservationClusterAssignment | null> {
    const assignment = this.assignments.get(id);
    return assignment === undefined ? null : clone(assignment);
  }

  async findByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<readonly ObservationClusterAssignment[]> {
    return [...this.assignments.values()]
      .filter(
        (assignment) =>
          assignment.sourceObservationId === sourceObservationId,
      )
      .sort(compareAssignments)
      .map(clone);
  }

  async findEffectiveByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null> {
    return findOne(
      this.assignments.values(),
      sourceObservationId,
      isEffective,
      "effective assignment",
    );
  }

  async findCurrentProposalByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<ObservationClusterAssignment | null> {
    return findOne(
      this.assignments.values(),
      sourceObservationId,
      ({ status }) => status === "PROPOSED",
      "current proposal",
    );
  }
}

function enforceCurrentState(
  assignments: Iterable<ObservationClusterAssignment>,
  candidate: ObservationClusterAssignment,
): void {
  for (const assignment of assignments) {
    if (assignment.sourceObservationId !== candidate.sourceObservationId) continue;
    if (isEffective(assignment) && isEffective(candidate)) {
      throw new Error(
        `SourceObservation "${candidate.sourceObservationId}" already has an effective employer-cluster assignment.`,
      );
    }
    if (assignment.status === "PROPOSED" && candidate.status === "PROPOSED") {
      throw new Error(
        `SourceObservation "${candidate.sourceObservationId}" already has a current employer-cluster proposal.`,
      );
    }
  }
}

function findOne(
  assignments: Iterable<ObservationClusterAssignment>,
  sourceObservationId: SourceObservationId,
  predicate: (assignment: ObservationClusterAssignment) => boolean,
  label: string,
): ObservationClusterAssignment | null {
  const matches = [...assignments].filter(
    (assignment) =>
      assignment.sourceObservationId === sourceObservationId &&
      predicate(assignment),
  );
  if (matches.length > 1) {
    throw new Error(
      `Observation-cluster assignment integrity error: multiple ${label}s exist for SourceObservation "${sourceObservationId}".`,
    );
  }
  return matches[0] === undefined ? null : clone(matches[0]);
}

function isEffective(assignment: ObservationClusterAssignment): boolean {
  return assignment.status === "ACCEPTED" || assignment.status === "USER_CONFIRMED";
}

function compareAssignments(
  left: ObservationClusterAssignment,
  right: ObservationClusterAssignment,
): number {
  return (
    left.evaluatedAt.getTime() - right.evaluatedAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function validateAssignment(assignment: ObservationClusterAssignment): void {
  if (
    !Number.isFinite(assignment.confidence) ||
    assignment.confidence < 0 ||
    assignment.confidence > 1
  ) {
    throw new Error("Observation-cluster assignment confidence must be between 0 and 1.");
  }
  if (assignment.algorithm.trim().length === 0) {
    throw new Error("Recognition algorithm is required.");
  }
  if (assignment.algorithmVersion.trim().length === 0) {
    throw new Error("Recognition algorithm version is required.");
  }
  if (Number.isNaN(assignment.evaluatedAt.getTime())) {
    throw new Error("Observation-cluster assignment evaluatedAt must be a valid date.");
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
