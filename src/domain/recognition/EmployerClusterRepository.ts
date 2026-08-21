import type {
  EmployerCluster,
  EmployerClusterId,
} from "./EmployerCluster.js";

export interface EmployerClusterSearchCriteria {
  readonly locationHint?: string;
  readonly displayedCompanyNameHint?: string;
}

export interface EmployerClusterRepository {
  save(cluster: EmployerCluster): Promise<void>;

  findById(
    id: EmployerClusterId,
  ): Promise<EmployerCluster | null>;

  findCandidates(
    criteria: EmployerClusterSearchCriteria,
  ): Promise<readonly EmployerCluster[]>;
}
