import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerClusterId } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerClusterObservationProvider } from "../../domain/recognition/EmployerClusterObservationProvider.js";

export class InMemoryEmployerClusterObservationProvider
  implements EmployerClusterObservationProvider
{
  private readonly observationsByCluster = new Map<
    EmployerClusterId,
    SourceObservation[]
  >();

  addObservation(
    clusterId: EmployerClusterId,
    observation: SourceObservation,
  ): void {
    const observations = this.observationsByCluster.get(clusterId) ?? [];
    observations.push(observation);
    this.observationsByCluster.set(clusterId, observations);
  }

  async findObservationsByClusterId(
    clusterId: EmployerClusterId,
  ): Promise<readonly SourceObservation[]> {
    return [...(this.observationsByCluster.get(clusterId) ?? [])];
  }
}
