import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerClusterMatcher } from "../../src/domain/recognition/EmployerClusterMatcher.js";
import { evaluateObservationEmployerCluster } from "../../src/application/recognition/evaluateObservationEmployerCluster.js";
import { createEmployerCluster } from "../../src/application/recognition/createEmployerCluster.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";

const observation: SourceObservation = {
  id: "observation-1",
  source: { sourceType: "MANUAL", sourceName: "test" },
  observedAt: new Date("2026-08-21T00:00:00.000Z"),
  displayedCompanyName: "Acme",
  locationText: "Strasbourg",
  metadata: {},
};

async function run(confidence: number | null) {
  const clusterRepository = new InMemoryEmployerClusterRepository();
  const assignmentRepository =
    new InMemoryObservationClusterAssignmentRepository();
  const cluster = createEmployerCluster(
    { displayLabel: "Acme Industries", primaryLocationHint: "Strasbourg" },
    { generateId: () => "cluster-1" },
  );
  await clusterRepository.save(cluster);

  const matcher: EmployerClusterMatcher = {
    async findBestMatch(receivedObservation, candidates) {
      expect(receivedObservation).toBe(observation);
      expect(candidates).toEqual([cluster]);
      return confidence === null
        ? null
        : { cluster, confidence, explanation: "controlled match" };
    },
  };

  const decision = await evaluateObservationEmployerCluster(observation, {
    clusterRepository,
    assignmentRepository,
    matcher,
    policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
    algorithm: "controlled-matcher",
    algorithmVersion: "1",
    generateAssignmentId: () => "assignment-1",
  });

  return {
    decision,
    assignments: await assignmentRepository.findByObservationId(observation.id),
  };
}

describe("evaluateObservationEmployerCluster", () => {
  it("persists an accepted assignment for an automatic match", async () => {
    const { decision, assignments } = await run(0.96);
    expect(decision.outcome).toBe("AUTO_MATCH");
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      employerClusterId: "cluster-1",
      status: "ACCEPTED",
      confidence: 0.96,
      explanation: "controlled match",
    });
  });

  it("persists only a proposed assignment when review is required", async () => {
    const { decision, assignments } = await run(0.82);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.status).toBe("PROPOSED");
  });

  it.each([0.64, null])("persists nothing for no match (%s)", async (confidence) => {
    const { decision, assignments } = await run(confidence);
    expect(decision).toEqual({ outcome: "NO_MATCH" });
    expect(assignments).toEqual([]);
  });
});
