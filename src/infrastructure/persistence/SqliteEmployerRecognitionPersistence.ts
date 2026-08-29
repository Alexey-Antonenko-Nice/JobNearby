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
