import { describe, expect, it } from "vitest";

import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";

describe("createObservationClusterAssignment", () => {
  it("creates a proposed observation-to-cluster assignment", () => {
    const evaluatedAt = new Date("2026-08-21T00:00:00.000Z");

    const assignment = createObservationClusterAssignment(
      {
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-17",
        confidence: 0.86,
        status: "PROPOSED",
        algorithm: "employer-cluster-matcher",
        algorithmVersion: "0.1.0",
        explanation: "Same location and similar employer fingerprint.",
      },
      {
        now: () => evaluatedAt,
        generateId: () => "assignment-1",
      },
    );

    expect(assignment).toEqual({
      id: "assignment-1",
      sourceObservationId: "observation-1",
      employerClusterId: "cluster-17",
      confidence: 0.86,
      status: "PROPOSED",
      algorithm: "employer-cluster-matcher",
      algorithmVersion: "0.1.0",
      evaluatedAt,
      explanation:
        "Same location and similar employer fingerprint.",
    });
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid confidence %s",
    (confidence) => {
      expect(() =>
        createObservationClusterAssignment({
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-1",
          confidence,
          status: "PROPOSED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        }),
      ).toThrow(
        "Observation-cluster assignment confidence must be between 0 and 1.",
      );
    },
  );

  it("accepts confidence boundaries 0 and 1", () => {
    for (const confidence of [0, 1]) {
      expect(() =>
        createObservationClusterAssignment({
          sourceObservationId: "observation-1",
          employerClusterId: "cluster-1",
          confidence,
          status: "PROPOSED",
          algorithm: "matcher",
          algorithmVersion: "0.1.0",
        }),
      ).not.toThrow();
    }
  });

  it("rejects an empty algorithm name", () => {
    expect(() =>
      createObservationClusterAssignment({
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-1",
        confidence: 0.8,
        status: "PROPOSED",
        algorithm: "   ",
        algorithmVersion: "0.1.0",
      }),
    ).toThrow("Recognition algorithm is required.");
  });

  it("rejects an empty algorithm version", () => {
    expect(() =>
      createObservationClusterAssignment({
        sourceObservationId: "observation-1",
        employerClusterId: "cluster-1",
        confidence: 0.8,
        status: "PROPOSED",
        algorithm: "matcher",
        algorithmVersion: "   ",
      }),
    ).toThrow("Recognition algorithm version is required.");
  });
});
