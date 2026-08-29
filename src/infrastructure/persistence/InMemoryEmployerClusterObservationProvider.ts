import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterObservationProvider } from "../../domain/recognition/EmployerClusterObservationProvider.js";
import type { InMemoryObservationClusterAssignmentRepository } from "./InMemoryObservationClusterAssignmentRepository.js";

export class InMemoryEmployerClusterObservationProvider
  implements EmployerClusterObservationProvider
{
  constructor(
    private readonly assignmentRepository: InMemoryObservationClusterAssignmentRepository,
    private readonly sourceObservationRepository: SourceObservationRepository,
  ) {}

  async findObservationsByClusterId(
    clusterId: EmployerClusterId,
  ): Promise<readonly SourceObservation[]> {
    const assignments = this.assignmentRepository.findEffectiveByClusterId(clusterId);
    const observations: SourceObservation[] = [];
    for (const assignment of assignments) {
      const observation = await this.sourceObservationRepository.findById(
        assignment.sourceObservationId,
      );
      if (observation !== null) observations.push(observation);
    }
    return observations;
  }
}
