import type {
  EmployerCluster,
  EmployerClusterId,
} from "../../domain/recognition/EmployerCluster.js";

import type {
  EmployerClusterRepository,
  EmployerClusterSearchCriteria,
} from "../../domain/recognition/EmployerClusterRepository.js";

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

  async findCandidates(
    criteria: EmployerClusterSearchCriteria,
  ): Promise<readonly EmployerCluster[]> {
    const locationHint = normalize(criteria.locationHint);
    const companyNameHint = normalize(
      criteria.displayedCompanyNameHint,
    );

    return [...this.clusters.values()].filter((cluster) => {
      const locationMatches =
        locationHint === undefined ||
        normalize(cluster.primaryLocationHint)?.includes(locationHint) === true;
      const companyNameMatches =
        companyNameHint === undefined ||
        normalize(cluster.displayLabel)?.includes(companyNameHint) === true;

      return locationMatches && companyNameMatches;
    });
  }
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
