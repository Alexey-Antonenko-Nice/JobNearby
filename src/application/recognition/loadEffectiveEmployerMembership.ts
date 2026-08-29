import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
import type { ObservationClusterAssignmentRepository } from "../../domain/recognition/ObservationClusterAssignmentRepository.js";

export interface EffectiveEmployerMembership {
  readonly cluster: EmployerCluster;
  readonly assignment: ObservationClusterAssignment;
}

export async function loadEffectiveEmployerMembership(
  sourceObservationId: SourceObservationId,
  dependencies: {
    readonly clusterRepository: EmployerClusterRepository;
    readonly assignmentRepository: ObservationClusterAssignmentRepository;
  },
): Promise<EffectiveEmployerMembership | null> {
  const assignment =
    await dependencies.assignmentRepository.findEffectiveByObservationId(
      sourceObservationId,
    );
  if (assignment === null) return null;

  const cluster = await dependencies.clusterRepository.findById(
    assignment.employerClusterId,
  );
  if (cluster === null) {
    throw new Error(
      `Employer-recognition integrity error: effective assignment "${assignment.id}" references missing EmployerCluster "${assignment.employerClusterId}".`,
    );
  }
  return { cluster, assignment };
}
