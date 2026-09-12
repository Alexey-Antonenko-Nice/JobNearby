import type { EmployerAliasEvidence, EmployerAliasEvidenceRepository } from "../../domain/recognition/EmployerAliasEvidence.js";
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
    private readonly aliasRepository?: EmployerAliasEvidenceRepository,
  ) {}

  private reviewQueue: Promise<void> = Promise.resolve();

  async saveEmployerReviewDecision(assignment: ObservationClusterAssignment, expectedEffectiveAssignmentId: string, newCluster?: EmployerCluster, aliasEvidence?: EmployerAliasEvidence): Promise<void> {
    const operation = this.reviewQueue.then(async () => {
      if (!["USER_CONFIRMED", "REJECTED"].includes(assignment.status)) throw new Error("Invalid employer review decision.");
      const current = await this.assignmentRepository.findEffectiveByObservationId(assignment.sourceObservationId);
      if (current?.id !== expectedEffectiveAssignmentId || current.status !== "ACCEPTED") throw new Error("Employer review candidate is no longer eligible.");
      if (aliasEvidence && (!this.aliasRepository || assignment.status !== "USER_CONFIRMED" || aliasEvidence.sourceAssignmentId !== assignment.id || aliasEvidence.employerClusterId !== assignment.employerClusterId)) throw new Error("Invalid alias confirmation proof.");
      if (newCluster) {
        if (assignment.status !== "USER_CONFIRMED" || assignment.employerClusterId !== newCluster.id) throw new Error("Invalid review cluster creation.");
        await this.clusterRepository.save(newCluster);
      }
      let inserted = false;
      try {
        if (assignment.status === "USER_CONFIRMED") await this.assignmentRepository.supersedeEffectiveAssignment(current.id, assignment, assignment.evaluatedAt);
        else await this.assignmentRepository.save(assignment);
        inserted = true;
        if (aliasEvidence) await this.aliasRepository!.save(aliasEvidence);
      } catch (error) {
        if (inserted) this.assignmentRepository.restoreReviewForRollback(current.id, assignment.id);
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
