import type { SourceObservation } from "../capture/SourceObservation.js";
import type { EmployerClusterId } from "./EmployerCluster.js";

export interface EmployerClusterObservationProvider {
  findObservationsByClusterId(
    clusterId: EmployerClusterId,
  ): Promise<readonly SourceObservation[]>;
}
