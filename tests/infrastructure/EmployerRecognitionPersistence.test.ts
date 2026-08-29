import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { ObservationClusterAssignment } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/SqliteEmployerRecognitionPersistence.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

describe("SqliteEmployerRecognitionPersistence", () => {
  it("atomically persists a new cluster and initial accepted assignment", async () => {
    const fixture = await setup();
    const cluster = makeCluster("new-cluster");
    const assignment = makeAssignment("new-assignment", cluster.id);
    await fixture.persistence.saveNewClusterWithAssignment(cluster, assignment);
    expect(await fixture.clusters.findById(cluster.id)).toEqual(cluster);
    expect(await fixture.assignments.findById(assignment.id)).toEqual(assignment);
    fixture.db.close();
  });

  it("rolls back the cluster when assignment insertion fails", async () => {
    const fixture = await setup(false);
    const cluster = makeCluster("rolled-back-cluster");
    const assignment = makeAssignment("invalid-assignment", cluster.id);
    await expect(
      fixture.persistence.saveNewClusterWithAssignment(cluster, assignment),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/u);
    expect(await fixture.clusters.findById(cluster.id)).toBeNull();
    expect(await fixture.assignments.findById(assignment.id)).toBeNull();
    fixture.db.close();
  });

  it("rolls back a losing cluster when effective membership already exists", async () => {
    const fixture = await setup();
    const winner = makeCluster("winner");
    await fixture.clusters.save(winner);
    await fixture.assignments.save(makeAssignment("winner-assignment", winner.id));
    const loser = makeCluster("loser");
    await expect(
      fixture.persistence.saveNewClusterWithAssignment(
        loser,
        makeAssignment("loser-assignment", loser.id),
      ),
    ).rejects.toThrow(/already has an effective employer-cluster assignment/u);
    expect(await fixture.clusters.findById(loser.id)).toBeNull();
    expect(await fixture.assignments.findById("loser-assignment")).toBeNull();
    fixture.db.close();
  });
});

async function setup(saveObservation = true) {
  const db = createDatabase(":memory:");
  if (saveObservation) {
    await new SqliteSourceObservationRepository(db).save({
      id: "observation-1",
      source: { sourceType: "MANUAL", sourceName: "test" },
      observedAt: new Date("2026-08-29T09:00:00.000Z"),
      metadata: {},
    });
  }
  return {
    db,
    persistence: new SqliteEmployerRecognitionPersistence(db),
    clusters: new SqliteEmployerClusterRepository(db),
    assignments: new SqliteObservationClusterAssignmentRepository(db),
  };
}

function makeCluster(id: string): EmployerCluster {
  return {
    id,
    status: "UNRESOLVED",
    createdAt: new Date("2026-08-29T10:00:00.000Z"),
    updatedAt: new Date("2026-08-29T10:00:00.000Z"),
  };
}

function makeAssignment(
  id: string,
  employerClusterId: string,
): ObservationClusterAssignment {
  return {
    id,
    sourceObservationId: "observation-1",
    employerClusterId,
    confidence: 1,
    status: "ACCEPTED",
    algorithm: "new-employer-cluster",
    algorithmVersion: "0.1.0",
    evaluatedAt: new Date("2026-08-29T10:00:00.000Z"),
  };
}
