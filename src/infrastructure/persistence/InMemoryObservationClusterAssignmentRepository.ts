import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentId,
} from "../../domain/recognition/ObservationClusterAssignment.js";

import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";

export class InMemoryObservationClusterAssignmentRepository
  implements ObservationClusterAssignmentRepository
{
  private readonly assignments = new Map<
    ObservationClusterAssignmentId,
    ObservationClusterAssignment
  >();

  async save(
    assignment: ObservationClusterAssignment,
  ): Promise<void> {
    if (this.assignments.has(assignment.id)) {
      throw new Error(
        `ObservationClusterAssignment with id "${assignment.id}" already exists.`,
      );
    }

    this.assignments.set(assignment.id, assignment);
  }

  async findById(
    id: ObservationClusterAssignmentId,
  ): Promise<ObservationClusterAssignment | null> {
    return this.assignments.get(id) ?? null;
  }

  async findByObservationId(
    sourceObservationId: SourceObservationId,
  ): Promise<readonly ObservationClusterAssignment[]> {
    return [...this.assignments.values()].filter(
      (assignment) =>
        assignment.sourceObservationId === sourceObservationId,
    );
  }
}
