import type {
  EmployerCluster,
  EmployerClusterId,
} from "./EmployerCluster.js";

export interface EmployerClusterRepository {
  save(cluster: EmployerCluster): Promise<void>;

  findById(
    id: EmployerClusterId,
  ): Promise<EmployerCluster | null>;
}
