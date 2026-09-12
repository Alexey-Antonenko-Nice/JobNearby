import type { EmployerAliasEvidence } from "./EmployerAliasEvidence.js";
import type { EmployerCluster } from "./EmployerCluster.js";
import type { ObservationClusterAssignment } from "./ObservationClusterAssignment.js";

export interface EmployerRecognitionPersistence {
  /** Atomically preserve history while recording an explicit review decision. */
  saveEmployerReviewDecision?(
    assignment: ObservationClusterAssignment,
    expectedEffectiveAssignmentId: string,
    newCluster?: EmployerCluster,
    aliasEvidence?: EmployerAliasEvidence,
  ): Promise<void>;

  saveNewClusterWithAssignment(
    cluster: EmployerCluster,
    assignment: ObservationClusterAssignment,
  ): Promise<void>;
}
