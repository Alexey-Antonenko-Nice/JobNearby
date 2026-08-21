import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { EmployerClusterMatcher } from "../../src/domain/recognition/EmployerClusterMatcher.js";
import type { EmployerClusterRepository } from "../../src/domain/recognition/EmployerClusterRepository.js";
import { createEmployerCluster } from "../../src/application/recognition/createEmployerCluster.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";

function observation(locationText?: string): SourceObservation {
  return {
    id: "observation-1",
    source: { sourceType: "MANUAL", sourceName: "test" },
    observedAt: new Date("2026-08-21T00:00:00.000Z"),
    metadata: {},
    ...(locationText !== undefined ? { locationText } : {}),
  };
}

async function setup(matchConfidence: number | null, locationText?: string) {
  const clusterRepository = new InMemoryEmployerClusterRepository();
  const assignmentRepository =
    new InMemoryObservationClusterAssignmentRepository();
  const existingCluster = createEmployerCluster(
    {
      displayLabel: "Existing employer",
      ...(locationText !== undefined
        ? { primaryLocationHint: locationText }
        : {}),
    },
    { generateId: () => "existing-cluster" },
  );
  await clusterRepository.save(existingCluster);
  const matcher: EmployerClusterMatcher = {
    async findBestMatch(_observation, candidates) {
      return matchConfidence === null
        ? null
        : {
            cluster: candidates[0] ?? existingCluster,
            confidence: matchConfidence,
            explanation: "controlled match",
          };
    },
  };

  const result = await processObservation(observation(locationText), {
    clusterRepository,
    assignmentRepository,
    matcher,
    policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
    algorithm: "controlled-matcher",
    algorithmVersion: "1",
    now: () => new Date("2026-08-21T12:00:00.000Z"),
    generateClusterId: () => "new-cluster",
    generateAssignmentId: () => "new-assignment",
  });

  return { result, clusterRepository, assignmentRepository, existingCluster };
}

describe("processObservation", () => {
  it("creates an unresolved cluster with location hints after no match", async () => {
    const { result, clusterRepository } = await setup(null, "Molsheim");

    expect(result.outcome).toBe("CREATED_NEW_CLUSTER");
    const cluster = await clusterRepository.findById("new-cluster");
    expect(cluster).toMatchObject({
      status: "UNRESOLVED",
      primaryLocationHint: "Molsheim",
      displayLabel: "Unknown employer — Molsheim",
    });
    expect(cluster).not.toHaveProperty("resolvedEmployerId");
  });

  it("uses a neutral label and omits the location hint when unavailable", async () => {
    const { result } = await setup(null);
    expect(result.outcome).toBe("CREATED_NEW_CLUSTER");
    if (result.outcome !== "CREATED_NEW_CLUSTER") throw new Error("unexpected result");
    expect(result.employerCluster.displayLabel).toBe("Unknown employer");
    expect(result.employerCluster).not.toHaveProperty("primaryLocationHint");
  });

  it("records certain membership by construction without resolving identity", async () => {
    const { result, assignmentRepository } = await setup(null, "Molsheim");
    expect(result.outcome).toBe("CREATED_NEW_CLUSTER");
    expect(await assignmentRepository.findById("new-assignment")).toMatchObject({
      status: "ACCEPTED",
      confidence: 1,
      algorithm: "new-employer-cluster",
      algorithmVersion: "0.1.0",
      explanation: "New unresolved employer cluster created for this observation.",
    });
  });

  it("treats a below-review candidate like no match", async () => {
    const { result } = await setup(0.64, "Molsheim");
    expect(result.outcome).toBe("CREATED_NEW_CLUSTER");
  });

  it("returns an existing automatic match without creating a cluster", async () => {
    const { result, clusterRepository, existingCluster } =
      await setup(0.96, "Molsheim");
    expect(result).toMatchObject({
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: existingCluster,
      assignment: { status: "ACCEPTED", confidence: 0.96 },
    });
    expect(await clusterRepository.findById("new-cluster")).toBeNull();
  });

  it("returns a proposal without creating a cluster when review is required", async () => {
    const { result, clusterRepository } = await setup(0.82, "Molsheim");
    expect(result).toMatchObject({
      outcome: "REVIEW_REQUIRED",
      confidence: 0.82,
      proposal: { status: "PROPOSED" },
    });
    expect(await clusterRepository.findById("new-cluster")).toBeNull();
  });

  it("does not attempt assignment persistence when cluster saving fails", async () => {
    const assignments = new InMemoryObservationClusterAssignmentRepository();
    let assignmentSaveAttempted = false;
    const assignmentRepository = {
      save: async (...args: Parameters<typeof assignments.save>) => {
        assignmentSaveAttempted = true;
        return assignments.save(...args);
      },
      findById: assignments.findById.bind(assignments),
      findByObservationId: assignments.findByObservationId.bind(assignments),
    };
    const clusterRepository: EmployerClusterRepository = {
      async save(_cluster: EmployerCluster) {
        throw new Error("cluster save failed");
      },
      async findById() {
        return null;
      },
      async findCandidates() {
        return [];
      },
    };

    await expect(
      processObservation(observation("Molsheim"), {
        clusterRepository,
        assignmentRepository,
        matcher: { async findBestMatch() { return null; } },
        policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
        algorithm: "controlled-matcher",
        algorithmVersion: "1",
      }),
    ).rejects.toThrow("cluster save failed");
    expect(assignmentSaveAttempted).toBe(false);
    expect(await assignments.findByObservationId("observation-1")).toEqual([]);
  });

  it("propagates assignment failure and leaves the already-saved cluster visible", async () => {
    const clusters = new InMemoryEmployerClusterRepository();
    const assignments = new InMemoryObservationClusterAssignmentRepository();

    await expect(
      processObservation(observation("Molsheim"), {
        clusterRepository: clusters,
        assignmentRepository: {
          async save() {
            throw new Error("assignment save failed");
          },
          findById: assignments.findById.bind(assignments),
          findByObservationId: assignments.findByObservationId.bind(assignments),
        },
        matcher: { async findBestMatch() { return null; } },
        policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
        algorithm: "controlled-matcher",
        algorithmVersion: "1",
        generateClusterId: () => "new-cluster",
      }),
    ).rejects.toThrow("assignment save failed");

    expect(await clusters.findById("new-cluster")).not.toBeNull();
  });
});
