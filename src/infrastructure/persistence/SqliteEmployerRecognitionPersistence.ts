import type { EmployerAliasEvidence } from "../../domain/recognition/EmployerAliasEvidence.js";
import { insertEmployerAliasEvidence } from "./SqliteEmployerAliasEvidenceRepository.js";
import type Database from "better-sqlite3";

import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { EmployerRecognitionPersistence } from "../../domain/recognition/EmployerRecognitionPersistence.js";
import type { ObservationClusterAssignment } from "../../domain/recognition/ObservationClusterAssignment.js";
import { insertEmployerCluster } from "./SqliteEmployerClusterRepository.js";
import { insertObservationClusterAssignment } from "./SqliteObservationClusterAssignmentRepository.js";

export class SqliteEmployerRecognitionPersistence
  implements EmployerRecognitionPersistence
{
  constructor(private readonly db: Database.Database) {}

  async saveEmployerReviewDecision(assignment: ObservationClusterAssignment, expectedEffectiveAssignmentId: string, newCluster?: EmployerCluster, aliasEvidence?: EmployerAliasEvidence): Promise<void> {
    if (!["USER_CONFIRMED", "REJECTED"].includes(assignment.status)) throw new Error("Invalid employer review decision.");
    this.db.transaction(() => {
      const current = this.db.prepare("SELECT id, status FROM observation_cluster_assignments WHERE source_observation_id = ? AND superseded_at IS NULL AND status IN ('ACCEPTED', 'USER_CONFIRMED')").get(assignment.sourceObservationId) as { id: string; status: string } | undefined;
      if (current?.id !== expectedEffectiveAssignmentId || current.status !== "ACCEPTED") throw new Error("Employer review candidate is no longer eligible.");
      if (newCluster) {
        if (assignment.status !== "USER_CONFIRMED" || assignment.employerClusterId !== newCluster.id) throw new Error("Invalid review cluster creation.");
        insertEmployerCluster(this.db, newCluster);
      }
      if (assignment.status === "USER_CONFIRMED") this.db.prepare("UPDATE observation_cluster_assignments SET superseded_at = ? WHERE id = ?").run(assignment.evaluatedAt.toISOString(), current.id);
      insertObservationClusterAssignment(this.db, assignment);
      if (aliasEvidence) {
        if (assignment.status !== "USER_CONFIRMED" || aliasEvidence.sourceAssignmentId !== assignment.id || aliasEvidence.employerClusterId !== assignment.employerClusterId) throw new Error("Invalid alias confirmation proof.");
        insertEmployerAliasEvidence(this.db, aliasEvidence);
      }
    })();
  }

  async saveNewClusterWithAssignment(
    cluster: EmployerCluster,
    assignment: ObservationClusterAssignment,
  ): Promise<void> {
    validateInitialAssignment(cluster, assignment);
    const save = this.db.transaction(() => {
      insertEmployerCluster(this.db, cluster);
      insertObservationClusterAssignment(this.db, assignment);
    });
    save();
  }
}

function validateInitialAssignment(
  cluster: EmployerCluster,
  assignment: ObservationClusterAssignment,
): void {
  if (assignment.employerClusterId !== cluster.id) {
    throw new Error("Initial assignment must reference the new EmployerCluster.");
  }
  if (assignment.status !== "ACCEPTED") {
    throw new Error("Initial new-cluster assignment must be ACCEPTED.");
  }
}
