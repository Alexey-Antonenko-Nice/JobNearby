import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { describe, expect, it } from "vitest";
import type { ObservationClusterAssignment } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { runObservationClusterAssignmentRepositoryContract } from "../recognition/ObservationClusterAssignmentRepository.contract.js";

runObservationClusterAssignmentRepositoryContract("SQLite", () => {
  const db = createDatabase(":memory:");
  const observations = new SqliteSourceObservationRepository(db);
  const clusters = new SqliteEmployerClusterRepository(db);
  const preparedObservations = new Set<string>();
  const preparedClusters = new Set<string>();
  return {
    repository: new SqliteObservationClusterAssignmentRepository(db),
    async prepare(assignment: ObservationClusterAssignment) {
      if (!preparedObservations.has(assignment.sourceObservationId)) {
        await observations.save({
          id: assignment.sourceObservationId,
          source: { sourceType: "MANUAL", sourceName: "contract" },
          observedAt: new Date("2026-08-29T09:00:00.000Z"),
          metadata: {},
        });
        preparedObservations.add(assignment.sourceObservationId);
      }
      if (!preparedClusters.has(assignment.employerClusterId)) {
        await clusters.save({
          id: assignment.employerClusterId,
          status: "UNRESOLVED",
          createdAt: new Date("2026-08-29T09:00:00.000Z"),
          updatedAt: new Date("2026-08-29T09:00:00.000Z"),
        });
        preparedClusters.add(assignment.employerClusterId);
      }
    },
    close: () => db.close(),
  };
});

describe("SqliteObservationClusterAssignmentRepository superseded history", () => {
  it("keeps superseded assignments in history while excluding them from current state", async () => {
    const db = createDatabase(":memory:");
    const observations = new SqliteSourceObservationRepository(db);
    const clusters = new SqliteEmployerClusterRepository(db);
    const repository = new SqliteObservationClusterAssignmentRepository(db);
    await observations.save({
      id: "observation-history",
      source: { sourceType: "MANUAL", sourceName: "test" },
      observedAt: new Date("2026-08-29T09:00:00.000Z"),
      metadata: {},
    });
    for (const id of ["cluster-old", "cluster-current"]) {
      await clusters.save({
        id,
        status: "UNRESOLVED",
        createdAt: new Date("2026-08-29T09:00:00.000Z"),
        updatedAt: new Date("2026-08-29T09:00:00.000Z"),
      });
    }
    const old = {
      id: "old-assignment",
      sourceObservationId: "observation-history",
      employerClusterId: "cluster-old",
      confidence: 0.9,
      status: "ACCEPTED" as const,
      algorithm: "matcher",
      algorithmVersion: "1",
      evaluatedAt: new Date("2026-08-29T10:00:00.000Z"),
    };
    const current = {
      ...old,
      id: "current-assignment",
      employerClusterId: "cluster-current",
      status: "USER_CONFIRMED" as const,
      evaluatedAt: new Date("2026-08-29T11:00:00.000Z"),
    };
    await repository.save(old);
    db.prepare(`
      UPDATE observation_cluster_assignments
      SET superseded_at = ? WHERE id = ?
    `).run("2026-08-29T10:30:00.000Z", old.id);
    await repository.save(current);

    expect(await repository.findByObservationId("observation-history"))
      .toEqual([old, current]);
    expect(await repository.findEffectiveByObservationId("observation-history"))
      .toEqual(current);
    db.close();
  });
});
