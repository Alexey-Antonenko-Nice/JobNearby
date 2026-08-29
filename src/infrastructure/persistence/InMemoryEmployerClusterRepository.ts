import type {
  EmployerCluster,
  EmployerClusterId,
} from "../../domain/recognition/EmployerCluster.js";

import type {
  EmployerClusterRepository,
  EmployerClusterSearchCriteria,
} from "../../domain/recognition/EmployerClusterRepository.js";
import { normalizeEmployerClusterSearchHint } from "../../domain/recognition/normalizeEmployerClusterSearchHint.js";

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

    validateCluster(cluster);
    this.clusters.set(cluster.id, clone(cluster));
  }

  async findById(
    id: EmployerClusterId,
  ): Promise<EmployerCluster | null> {
    const cluster = this.clusters.get(id);
    return cluster === undefined ? null : clone(cluster);
  }

  async findCandidates(
    criteria: EmployerClusterSearchCriteria,
  ): Promise<readonly EmployerCluster[]> {
    const locationHint = normalizeEmployerClusterSearchHint(criteria.locationHint);
    const companyNameHint = normalizeEmployerClusterSearchHint(
      criteria.displayedCompanyNameHint,
    );

    return [...this.clusters.values()].filter((cluster) => {
      const locationMatches =
        locationHint === undefined ||
        normalizeEmployerClusterSearchHint(cluster.primaryLocationHint)?.includes(locationHint) === true;
      const companyNameMatches =
        companyNameHint === undefined ||
        normalizeEmployerClusterSearchHint(cluster.displayLabel)?.includes(companyNameHint) === true;

      return locationMatches && companyNameMatches;
    }).map(clone);
  }
}

function validateCluster(cluster: EmployerCluster): void {
  if (cluster.status === "RESOLVED" && cluster.resolvedEmployerId === undefined) {
    throw new Error("A RESOLVED employer cluster requires resolvedEmployerId.");
  }
  if (cluster.status === "UNRESOLVED" && cluster.resolvedEmployerId !== undefined) {
    throw new Error("An UNRESOLVED employer cluster cannot have resolvedEmployerId.");
  }
  if (
    Number.isNaN(cluster.createdAt.getTime()) ||
    Number.isNaN(cluster.updatedAt.getTime())
  ) {
    throw new Error("Employer cluster timestamps must be valid dates.");
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
