import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";

import type {
  ObservationClusterAssignment,
  ObservationClusterAssignmentStatus,
} from "../../domain/recognition/ObservationClusterAssignment.js";

import {
  createObservationClusterAssignment,
  type CreateObservationClusterAssignmentDependencies,
  type CreateObservationClusterAssignmentInput,
} from "./createObservationClusterAssignment.js";

export interface RecordObservationClusterAssignmentDependencies
  extends CreateObservationClusterAssignmentDependencies {
  repository: ObservationClusterAssignmentRepository;
}

export async function recordObservationClusterAssignment(
  input: CreateObservationClusterAssignmentInput,
  dependencies: RecordObservationClusterAssignmentDependencies,
): Promise<ObservationClusterAssignment> {
  if (isAcceptedStatus(input.status)) {
    const existingAssignments =
      await dependencies.repository.findByObservationId(
        input.sourceObservationId,
      );

    const existingAccepted = existingAssignments.find(
      (assignment) =>
        isAcceptedStatus(assignment.status) &&
        assignment.employerClusterId !== input.employerClusterId,
    );

    if (existingAccepted !== undefined) {
      throw new Error(
        `SourceObservation "${input.sourceObservationId}" already has an accepted assignment to EmployerCluster "${existingAccepted.employerClusterId}".`,
      );
    }
  }

  const assignment = createObservationClusterAssignment(
    input,
    dependencies,
  );

  await dependencies.repository.save(assignment);

  return assignment;
}

function isAcceptedStatus(
  status: ObservationClusterAssignmentStatus,
): boolean {
  return status === "ACCEPTED" || status === "USER_CONFIRMED";
}
