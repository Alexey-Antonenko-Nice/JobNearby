import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
} from "../../domain/recognition/ObservationClusterAssignment.js";

import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import {
  CurrentProposalConflictError,
  EffectiveAssignmentConflictError,
} from "../../domain/recognition/EmployerRecognitionPersistenceError.js";

export class InMemoryObservationClusterAssignmentRepository
  implements ObservationClusterAssignmentRepository
{
  private readonly assignments = new Map<
    ObservationClusterAssignmentId,
    {
      readonly assignment: ObservationClusterAssignment;
      supersededAt: Date | null;
    }
  >();

  findEffectiveByClusterId(
    employerClusterId: EmployerClusterId,
  ): readonly ObservationClusterAssignment[] {
    return [...this.assignments.values()]
      .filter(
        ({ assignment, supersededAt }) =>
          assignment.employerClusterId === employerClusterId &&
          supersededAt === null &&
          isEffective(assignment),
      )
      .map(({ assignment }) => assignment)
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
    this.assignments.set(assignment.id, {
      assignment: clone(assignment),
      supersededAt: null,
    });
  }

  async findById(
    id: ObservationClusterAssignmentId,
  ): Promise<ObservationClusterAssignment | null> {
    const record = this.assignments.get(id);
    return record === undefined ? null : clone(record.assignment);
  }

  async findByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<readonly ObservationClusterAssignment[]> {
    return [...this.assignments.values()]
      .filter(
        ({ assignment }) =>
          assignment.sourceObservationId === sourceObservationId,
      )
      .map(({ assignment }) => assignment)
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

  async replaceCurrentProposal(
    existingProposalId: ObservationClusterAssignmentId,
    replacement: ObservationClusterAssignment,
    supersededAt: Date,
  ): Promise<void> {
    validateAssignment(replacement);
    if (replacement.status !== "PROPOSED") {
      throw new Error("Replacement assignment must be PROPOSED.");
    }
    if (Number.isNaN(supersededAt.getTime())) {
      throw new Error("Proposal supersededAt must be a valid date.");
    }
    const existing = this.assignments.get(existingProposalId);
    if (existing === undefined) {
      throw new Error(`Current proposal "${existingProposalId}" does not exist.`);
    }
    if (
      existing.assignment.status !== "PROPOSED" ||
      existing.supersededAt !== null
    ) {
      throw new Error(`Assignment "${existingProposalId}" is not a current proposal.`);
    }
    if (
      existing.assignment.sourceObservationId !== replacement.sourceObservationId
    ) {
      throw new Error("Replacement proposal must belong to the same SourceObservation.");
    }
    if (this.assignments.has(replacement.id)) {
      throw new Error(
        `ObservationClusterAssignment with id "${replacement.id}" already exists.`,
      );
    }

    existing.supersededAt = new Date(supersededAt);
    try {
      await this.save(replacement);
    } catch (error) {
      existing.supersededAt = null;
      throw error;
    }
  }
}

interface AssignmentRecord {
  readonly assignment: ObservationClusterAssignment;
  readonly supersededAt: Date | null;
}

function enforceCurrentState(
  assignments: Iterable<AssignmentRecord>,
  candidate: ObservationClusterAssignment,
): void {
  for (const { assignment, supersededAt } of assignments) {
    if (supersededAt !== null) continue;
    if (assignment.sourceObservationId !== candidate.sourceObservationId) continue;
    if (isEffective(assignment) && isEffective(candidate)) {
      throw new EffectiveAssignmentConflictError(candidate.sourceObservationId);
    }
    if (assignment.status === "PROPOSED" && candidate.status === "PROPOSED") {
      throw new CurrentProposalConflictError(candidate.sourceObservationId);
    }
  }
}

function findOne(
  assignments: Iterable<AssignmentRecord>,
  sourceObservationId: SourceObservationId,
  predicate: (assignment: ObservationClusterAssignment) => boolean,
  label: string,
): ObservationClusterAssignment | null {
  const matches = [...assignments].filter(
    ({ assignment, supersededAt }) =>
      supersededAt === null &&
      assignment.sourceObservationId === sourceObservationId &&
      predicate(assignment),
  ).map(({ assignment }) => assignment);
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
