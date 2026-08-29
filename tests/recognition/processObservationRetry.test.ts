import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { EmployerClusterMatcher } from "../../src/domain/recognition/EmployerClusterMatcher.js";
import type { ObservationClusterAssignment } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import { EffectiveAssignmentConflictError } from "../../src/domain/recognition/EmployerRecognitionPersistenceError.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/InMemoryEmployerRecognitionPersistence.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";

const observation: SourceObservation = {
  id: "observation-retry",
  source: { sourceType: "MANUAL", sourceName: "test" },
  observedAt: new Date("2026-08-29T09:00:00.000Z"),
  locationText: "Strasbourg",
  metadata: {},
};

describe("processObservation retry safety", () => {
  it.each(["ACCEPTED", "USER_CONFIRMED"] as const)(
    "short-circuits existing %s membership without running the matcher",
    async (status) => {
      const environment = await createEnvironment(null);
      const effectiveCluster = cluster(`effective-${status}`);
      await environment.clusters.save(effectiveCluster);
      const assignment = effectiveAssignment(
        `assignment-${status}`,
        effectiveCluster.id,
        status,
      );
      await environment.assignments.save(assignment);

      const result = await processObservation(observation, environment.dependencies);

      expect(result).toEqual({
        outcome: "MATCHED_EXISTING_CLUSTER",
        employerCluster: effectiveCluster,
        assignment,
      });
      expect(environment.matcherCalls()).toBe(0);
      expect(await environment.assignments.findByObservationId(observation.id))
        .toHaveLength(1);
    },
  );

  it("reuses the same unresolved cluster and assignment on a NO_MATCH retry", async () => {
    const environment = await createEnvironment(null);
    const first = await processObservation(observation, environment.dependencies);
    const second = await processObservation(observation, environment.dependencies);

    expect(first).toMatchObject({ outcome: "CREATED_NEW_CLUSTER" });
    expect(second).toMatchObject({
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: first.outcome === "CREATED_NEW_CLUSTER"
        ? first.employerCluster
        : undefined,
    });
    expect(environment.matcherCalls()).toBe(1);
    expect(await environment.assignments.findByObservationId(observation.id))
      .toHaveLength(1);
    expect(await environment.clusters.findCandidates({})).toHaveLength(2);
  });

  it("reuses an identical current REVIEW_REQUIRED proposal", async () => {
    const environment = await createEnvironment(0.82);
    const first = await processObservation(observation, environment.dependencies);
    const second = await processObservation(observation, environment.dependencies);

    expect(first).toMatchObject({ outcome: "REVIEW_REQUIRED" });
    expect(second).toEqual(first);
    expect(await environment.assignments.findByObservationId(observation.id))
      .toHaveLength(1);
    expect(await environment.assignments.findCurrentProposalByObservationId(observation.id))
      .toEqual(first.outcome === "REVIEW_REQUIRED" ? first.proposal : null);
  });

  it("supersedes a materially changed review proposal and preserves history", async () => {
    let confidence = 0.82;
    const environment = await createEnvironment(() => confidence);
    const first = await processObservation(observation, environment.dependencies);
    confidence = 0.84;
    const second = await processObservation(observation, environment.dependencies);

    expect(first).toMatchObject({ outcome: "REVIEW_REQUIRED", confidence: 0.82 });
    expect(second).toMatchObject({ outcome: "REVIEW_REQUIRED", confidence: 0.84 });
    const history = await environment.assignments.findByObservationId(observation.id);
    expect(history).toHaveLength(2);
    expect(await environment.assignments.findCurrentProposalByObservationId(observation.id))
      .toEqual(second.outcome === "REVIEW_REQUIRED" ? second.proposal : null);
  });

  it("returns the effective race winner after an AUTO_MATCH conflict", async () => {
    const clusters = new InMemoryEmployerClusterRepository();
    const winnerCluster = cluster("race-winner");
    const matchedCluster = cluster("machine-candidate");
    await clusters.save(winnerCluster);
    await clusters.save(matchedCluster);
    const winner = effectiveAssignment("winner-assignment", winnerCluster.id, "USER_CONFIRMED");
    class RacingAssignments extends InMemoryObservationClusterAssignmentRepository {
      private raced = false;
      override async save(candidate: ObservationClusterAssignment): Promise<void> {
        if (!this.raced && candidate.status === "ACCEPTED") {
          this.raced = true;
          await super.save(winner);
          throw new EffectiveAssignmentConflictError(candidate.sourceObservationId);
        }
        await super.save(candidate);
      }
    }
    const assignments = new RacingAssignments();
    let matcherCalls = 0;
    const result = await processObservation(observation, {
      clusterRepository: clusters,
      assignmentRepository: assignments,
      recognitionPersistence: new InMemoryEmployerRecognitionPersistence(
        clusters,
        assignments,
      ),
      matcher: {
        async findBestMatch() {
          matcherCalls += 1;
          return { cluster: matchedCluster, confidence: 0.96 };
        },
      },
      policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
      algorithm: "matcher",
      algorithmVersion: "1",
      generateAssignmentId: () => "losing-assignment",
    });

    expect(result).toEqual({
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: winnerCluster,
      assignment: winner,
    });
    expect(matcherCalls).toBe(1);
  });

  it("returns the effective race winner after a NO_MATCH persistence conflict", async () => {
    const environment = await createEnvironment(null);
    const winnerCluster = cluster("no-match-winner");
    const winner = effectiveAssignment("no-match-winner-assignment", winnerCluster.id, "ACCEPTED");
    const racingDependencies = {
      ...environment.dependencies,
      recognitionPersistence: {
      async saveNewClusterWithAssignment() {
        await environment.clusters.save(winnerCluster);
        await environment.assignments.save(winner);
        throw new EffectiveAssignmentConflictError(observation.id);
      },
      },
    };

    const result = await processObservation(observation, racingDependencies);
    expect(result).toEqual({
      outcome: "MATCHED_EXISTING_CLUSTER",
      employerCluster: winnerCluster,
      assignment: winner,
    });
    expect(await environment.clusters.findById("new-cluster-1")).toBeNull();
  });

  it("fails explicitly when effective membership references a missing cluster", async () => {
    const environment = await createEnvironment(null);
    await environment.assignments.save(
      effectiveAssignment("corrupt-assignment", "missing-cluster", "ACCEPTED"),
    );
    await expect(
      processObservation(observation, environment.dependencies),
    ).rejects.toThrow(/references missing EmployerCluster "missing-cluster"/u);
    expect(environment.matcherCalls()).toBe(0);
  });
});

async function createEnvironment(
  matchConfidence: number | null | (() => number),
) {
  const clusters = new InMemoryEmployerClusterRepository();
  const assignments = new InMemoryObservationClusterAssignmentRepository();
  const candidate = cluster("candidate-cluster");
  await clusters.save(candidate);
  let matcherCallCount = 0;
  let clusterSequence = 0;
  let assignmentSequence = 0;
  let timeSequence = 0;
  const matcher: EmployerClusterMatcher = {
    async findBestMatch() {
      matcherCallCount += 1;
      const confidence = typeof matchConfidence === "function"
        ? matchConfidence()
        : matchConfidence;
      return confidence === null
        ? null
        : { cluster: candidate, confidence, explanation: "controlled match" };
    },
  };
  const dependencies = {
    clusterRepository: clusters,
    assignmentRepository: assignments,
    recognitionPersistence: new InMemoryEmployerRecognitionPersistence(
      clusters,
      assignments,
    ),
    matcher,
    policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 },
    algorithm: "controlled-matcher",
    algorithmVersion: "1",
    now: () => new Date(Date.UTC(2026, 7, 29, 10, 0, timeSequence++)),
    generateClusterId: () => `new-cluster-${++clusterSequence}`,
    generateAssignmentId: () => `new-assignment-${++assignmentSequence}`,
  };
  return {
    clusters,
    assignments,
    dependencies,
    matcherCalls: () => matcherCallCount,
  };
}

function cluster(id: string): EmployerCluster {
  return {
    id,
    status: "UNRESOLVED",
    createdAt: new Date("2026-08-29T09:00:00.000Z"),
    updatedAt: new Date("2026-08-29T09:00:00.000Z"),
    primaryLocationHint: "Strasbourg",
  };
}

function effectiveAssignment(
  id: string,
  employerClusterId: string,
  status: "ACCEPTED" | "USER_CONFIRMED",
): ObservationClusterAssignment {
  return {
    id,
    sourceObservationId: observation.id,
    employerClusterId,
    confidence: 1,
    status,
    algorithm: status === "USER_CONFIRMED" ? "human" : "matcher",
    algorithmVersion: "1",
    evaluatedAt: new Date("2026-08-29T09:30:00.000Z"),
  };
}
