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

  private reviewQueue: Promise<void> = Promise.resolve();

  async saveEmployerReviewDecision(assignment: ObservationClusterAssignment, expectedEffectiveAssignmentId: string, newCluster?: EmployerCluster): Promise<void> {
    const operation = this.reviewQueue.then(async () => {
      if (!["USER_CONFIRMED", "REJECTED"].includes(assignment.status)) throw new Error("Invalid employer review decision.");
      const current = await this.assignmentRepository.findEffectiveByObservationId(assignment.sourceObservationId);
      if (current?.id !== expectedEffectiveAssignmentId || current.status !== "ACCEPTED") throw new Error("Employer review candidate is no longer eligible.");
      if (newCluster) {
        if (assignment.status !== "USER_CONFIRMED" || assignment.employerClusterId !== newCluster.id) throw new Error("Invalid review cluster creation.");
        await this.clusterRepository.save(newCluster);
      }
      try {
        if (assignment.status === "USER_CONFIRMED") await this.assignmentRepository.supersedeEffectiveAssignment(current.id, assignment, assignment.evaluatedAt);
        else await this.assignmentRepository.save(assignment);
      } catch (error) {
        if (newCluster) this.clusterRepository.deleteForRollback(newCluster.id);
        throw error;
      }
    });
    this.reviewQueue = operation.catch(() => {});
    return operation;
  }

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
