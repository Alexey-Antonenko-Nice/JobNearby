import { describe, expect, it } from "vitest";

import { recordObservationClusterAssignment } from "../../src/application/recognition/recordObservationClusterAssignment.js";

import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";

describe("recordObservationClusterAssignment", () => {
  it("records an accepted cluster assignment", async () => {
    const repository =
      new InMemoryObservationClusterAssignmentRepository();

    const assignment =
      await recordObservationClusterAssignment(
        {
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-1",
          confidence: 0.95,
          status: "ACCEPTED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        },
        {
          repository,
          generateId: () => "assignment-1",
          now: () =>
            new Date("2026-08-21T00:00:00.000Z"),
        },
      );

    expect(
      await repository.findById("assignment-1"),
    ).toEqual(assignment);
  });

  it("rejects a second current proposal for one observation", async () => {
    const repository =
      new InMemoryObservationClusterAssignmentRepository();

    await recordObservationClusterAssignment(
      {
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-1",
        confidence: 0.72,
        status: "PROPOSED",
        algorithm: "matcher",
        algorithmVersion: "0.1.0",
      },
      {
        repository,
        generateId: () => "assignment-1",
      },
    );

    await expect(
      recordObservationClusterAssignment(
        {
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-2",
          confidence: 0.61,
          status: "PROPOSED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        },
        {
          repository,
          generateId: () => "assignment-2",
        },
      ),
    ).rejects.toThrow(/already has a current employer-cluster proposal/u);

    const assignments =
      await repository.findByObservationId(
        "observation-1",
      );

    expect(assignments).toHaveLength(1);
  });

  it("allows rejected history before accepting another cluster", async () => {
    const repository =
      new InMemoryObservationClusterAssignmentRepository();

    await recordObservationClusterAssignment(
      {
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-wrong",
        confidence: 0.8,
        status: "REJECTED",
        algorithm: "matcher",
        algorithmVersion: "0.1.0",
      },
      {
        repository,
        generateId: () => "assignment-rejected",
      },
    );

    await expect(
      recordObservationClusterAssignment(
        {
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-correct",
          confidence: 0.98,
          status: "ACCEPTED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        },
        {
          repository,
          generateId: () => "assignment-accepted",
        },
      ),
    ).resolves.toBeDefined();
  });

  it("rejects acceptance into a second different cluster", async () => {
    const repository =
      new InMemoryObservationClusterAssignmentRepository();

    await recordObservationClusterAssignment(
      {
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-1",
        confidence: 0.95,
        status: "ACCEPTED",
        algorithm: "matcher",
        algorithmVersion: "0.1.0",
      },
      {
        repository,
        generateId: () => "assignment-1",
      },
    );

    await expect(
      recordObservationClusterAssignment(
        {
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-2",
          confidence: 0.99,
          status: "ACCEPTED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        },
        {
          repository,
          generateId: () => "assignment-2",
        },
      ),
    ).rejects.toThrow(
      'SourceObservation "observation-1" already has an effective employer-cluster assignment.',
    );
  });

  it("treats USER_CONFIRMED as an accepted assignment", async () => {
    const repository =
      new InMemoryObservationClusterAssignmentRepository();

    await recordObservationClusterAssignment(
      {
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-1",
        confidence: 1,
        status: "USER_CONFIRMED",
        algorithm: "human-confirmation",
        algorithmVersion: "1",
      },
      {
        repository,
        generateId: () => "assignment-1",
      },
    );

    await expect(
      recordObservationClusterAssignment(
        {
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-2",
          confidence: 0.99,
          status: "ACCEPTED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        },
        {
          repository,
          generateId: () => "assignment-2",
        },
      ),
    ).rejects.toThrow();
  });
});
