import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerRecognitionPersistence } from "../../domain/recognition/EmployerRecognitionPersistence.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
import { InMemoryEmployerClusterRepository } from "./InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "./InMemoryObservationClusterAssignmentRepository.js";

export class InMemoryEmployerRecognitionPersistence
  implements EmployerRecognitionPersistence
{
  constructor(
    private readonly clusterRepository: InMemoryEmployerClusterRepository,
    private readonly assignmentRepository: InMemoryObservationClusterAssignmentRepository,
  ) {}

  async saveNewClusterWithAssignment(
    cluster: EmployerCluster,
    assignment: ObservationClusterAssignment,
  ): Promise<void> {
    validateInitialAssignment(cluster, assignment);
    await this.clusterRepository.save(cluster);
    try {
      await this.assignmentRepository.save(assignment);
    } catch (error) {
      this.clusterRepository.deleteForRollback(cluster.id);
      throw error;
    }
  }
}

function validateInitialAssignment(
  cluster: EmployerCluster,
  assignment: ObservationClusterAssignment,
): void {
  if (assignment.employerClusterId !== cluster.id) {
    throw new Error("Initial assignment must reference the new EmployerCluster.");
  }
  if (assignment.status !== "ACCEPTED") {
    throw new Error("Initial new-cluster assignment must be ACCEPTED.");
  }
}
