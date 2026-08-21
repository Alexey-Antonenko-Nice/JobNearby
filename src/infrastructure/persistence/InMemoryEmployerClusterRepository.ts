import type {
  EmployerCluster,
  EmployerClusterId,
} from "../../domain/recognition/EmployerCluster.js";

import type { EmployerClusterRepository } from "../../domain/recognition/EmployerClusterRepository.js";

export class InMemoryEmployerClusterRepository
  implements EmployerClusterRepository
{
  private readonly clusters = new Map<
    EmployerClusterId,
    EmployerCluster
  >();

  async save(cluster: EmployerCluster): Promise<void> {
    if (this.clusters.has(cluster.id)) {
      throw new Error(
        `EmployerCluster with id "${cluster.id}" already exists.`,
      );
    }

    this.clusters.set(cluster.id, cluster);
  }

  async findById(
    id: EmployerClusterId,
  ): Promise<EmployerCluster | null> {
    return this.clusters.get(id) ?? null;
  }
}
