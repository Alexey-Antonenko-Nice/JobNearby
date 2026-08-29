import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { describe, expect, it } from "vitest";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { ObservationClusterAssignmentStatus } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import { InMemoryEmployerClusterObservationProvider } from "../../src/infrastructure/persistence/InMemoryEmployerClusterObservationProvider.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { SqliteEmployerClusterObservationProvider } from "../../src/infrastructure/persistence/SqliteEmployerClusterObservationProvider.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { runEmployerClusterObservationProviderContract } from "../recognition/EmployerClusterObservationProvider.contract.js";

runEmployerClusterObservationProviderContract("InMemory", () => {
  const assignments = new InMemoryObservationClusterAssignmentRepository();
  const observations = new InMemorySourceObservationRepository();
  let sequence = 0;
  return {
    provider: new InMemoryEmployerClusterObservationProvider(assignments, observations),
    async add(
      clusterId: string,
      observation: SourceObservation,
      status: ObservationClusterAssignmentStatus,
    ) {
      await observations.save(observation);
      sequence += 1;
      await assignments.save(makeAssignment(sequence, clusterId, observation.id, status));
    },
    close() {},
  };
});

runEmployerClusterObservationProviderContract("SQLite", () => {
  const db = createDatabase(":memory:");
  const assignments = new SqliteObservationClusterAssignmentRepository(db);
  const observations = new SqliteSourceObservationRepository(db);
  const clusters = new SqliteEmployerClusterRepository(db);
  const clusterIds = new Set<string>();
  let sequence = 0;
  return {
    provider: new SqliteEmployerClusterObservationProvider(db),
    async add(
      clusterId: string,
      observation: SourceObservation,
      status: ObservationClusterAssignmentStatus,
    ) {
      await observations.save(observation);
      if (!clusterIds.has(clusterId)) {
        await clusters.save({
          id: clusterId,
          status: "UNRESOLVED",
          createdAt: new Date("2026-08-29T09:00:00.000Z"),
          updatedAt: new Date("2026-08-29T09:00:00.000Z"),
        });
        clusterIds.add(clusterId);
      }
      sequence += 1;
      await assignments.save(makeAssignment(sequence, clusterId, observation.id, status));
    },
    close: () => db.close(),
  };
});

function makeAssignment(
  sequence: number,
  employerClusterId: string,
  sourceObservationId: string,
  status: ObservationClusterAssignmentStatus,
) {
  return {
    id: `provider-assignment-${sequence}`,
    sourceObservationId,
    employerClusterId,
    confidence: 1,
    status,
    algorithm: "provider-contract",
    algorithmVersion: "1",
    evaluatedAt: new Date(`2026-08-29T10:00:${String(sequence).padStart(2, "0")}.000Z`),
  };
}

describe("SqliteEmployerClusterObservationProvider superseded membership", () => {
  it("excludes superseded accepted and user-confirmed assignments", async () => {
    const db = createDatabase(":memory:");
    const observations = new SqliteSourceObservationRepository(db);
    const clusters = new SqliteEmployerClusterRepository(db);
    const assignments = new SqliteObservationClusterAssignmentRepository(db);
    const provider = new SqliteEmployerClusterObservationProvider(db);
    await clusters.save({
      id: "cluster-a",
      status: "UNRESOLVED",
      createdAt: new Date("2026-08-29T09:00:00.000Z"),
      updatedAt: new Date("2026-08-29T09:00:00.000Z"),
    });
    for (const [index, status] of (["ACCEPTED", "USER_CONFIRMED"] as const).entries()) {
      const observation = {
        id: `superseded-${index}`,
        source: { sourceType: "MANUAL" as const, sourceName: "test" },
        observedAt: new Date("2026-08-29T09:00:00.000Z"),
        metadata: {},
      };
      await observations.save(observation);
      const item = makeAssignment(index + 1, "cluster-a", observation.id, status);
      await assignments.save(item);
      db.prepare(`
        UPDATE observation_cluster_assignments
        SET superseded_at = ? WHERE id = ?
      `).run("2026-08-29T12:00:00.000Z", item.id);
    }
    expect(await provider.findObservationsByClusterId("cluster-a")).toEqual([]);
    db.close();
  });
});
