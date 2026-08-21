import { describe, expect, it } from "vitest";

import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import { decideEmployerClusterAssignment } from "../../src/domain/recognition/decideEmployerClusterAssignment.js";

const cluster: EmployerCluster = {
  id: "cluster-1",
  status: "UNRESOLVED",
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
  updatedAt: new Date("2026-08-21T00:00:00.000Z"),
};
const defaultPolicy = {
  automaticAssignmentThreshold: 0.9,
  reviewThreshold: 0.65,
};

describe("decideEmployerClusterAssignment", () => {
  it.each([0.96, 0.9])("auto-matches confidence %s", (confidence) => {
    expect(
      decideEmployerClusterAssignment(
        { cluster, confidence, explanation: "strong evidence" },
        defaultPolicy,
      ),
    ).toEqual({
      outcome: "AUTO_MATCH",
      cluster,
      confidence,
      explanation: "strong evidence",
    });
  });

  it.each([0.82, 0.65])("requires review for confidence %s", (confidence) => {
    expect(
      decideEmployerClusterAssignment({ cluster, confidence }, defaultPolicy),
    ).toEqual({
      outcome: "REVIEW_REQUIRED",
      candidateCluster: cluster,
      confidence,
    });
  });

  it("returns no match below the review threshold or without a match", () => {
    expect(
      decideEmployerClusterAssignment({ cluster, confidence: 0.64 }, defaultPolicy),
    ).toEqual({ outcome: "NO_MATCH" });
    expect(decideEmployerClusterAssignment(null, defaultPolicy)).toEqual({
      outcome: "NO_MATCH",
    });
  });

  it("changes decisions through policy without changing matcher output", () => {
    const match = { cluster, confidence: 0.8 };

    expect(
      decideEmployerClusterAssignment(match, {
        automaticAssignmentThreshold: 0.75,
        reviewThreshold: 0.5,
      }).outcome,
    ).toBe("AUTO_MATCH");
    expect(decideEmployerClusterAssignment(match, defaultPolicy).outcome).toBe(
      "REVIEW_REQUIRED",
    );
    expect(
      decideEmployerClusterAssignment(match, {
        automaticAssignmentThreshold: 0.9,
        reviewThreshold: 0.85,
      }).outcome,
    ).toBe("NO_MATCH");
  });
});
