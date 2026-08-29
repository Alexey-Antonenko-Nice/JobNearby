import type { EmployerCluster } from "./EmployerCluster.js";
import type { ObservationClusterAssignment } from "./ObservationClusterAssignment.js";

export interface EmployerRecognitionPersistence {
  saveNewClusterWithAssignment(
    cluster: EmployerCluster,
    assignment: ObservationClusterAssignment,
  ): Promise<void>;
}
