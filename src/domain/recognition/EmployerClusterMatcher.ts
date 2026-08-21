import type { SourceObservation } from "../capture/SourceObservation.js";
import type { EmployerCluster } from "./EmployerCluster.js";

export interface EmployerClusterMatch {
  readonly cluster: EmployerCluster;
  readonly confidence: number;
  readonly explanation?: string;
}

export interface EmployerClusterMatcher {
  findBestMatch(
    observation: SourceObservation,
    candidates: readonly EmployerCluster[],
  ): Promise<EmployerClusterMatch | null>;
}
