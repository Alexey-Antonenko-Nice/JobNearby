import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY,
  validateEmployerClusterAssignmentPolicy,
} from "../../src/domain/recognition/EmployerClusterAssignmentPolicy.js";

describe("EmployerClusterAssignmentPolicy", () => {
  it("provides the initial product defaults", () => {
    expect(DEFAULT_EMPLOYER_CLUSTER_ASSIGNMENT_POLICY).toEqual({
      automaticAssignmentThreshold: 0.9,
      reviewThreshold: 0.65,
    });
  });

  it("accepts ordered finite thresholds in the confidence range", () => {
    expect(
      validateEmployerClusterAssignmentPolicy({
        automaticAssignmentThreshold: 0.9,
        reviewThreshold: 0.65,
      }),
    ).toEqual({
      automaticAssignmentThreshold: 0.9,
      reviewThreshold: 0.65,
    });
  });

  it.each([
    { automaticAssignmentThreshold: 0.9, reviewThreshold: -0.01 },
    { automaticAssignmentThreshold: 1.01, reviewThreshold: 0.65 },
    { automaticAssignmentThreshold: 0.6, reviewThreshold: 0.65 },
    { automaticAssignmentThreshold: Number.NaN, reviewThreshold: 0.65 },
    { automaticAssignmentThreshold: 0.9, reviewThreshold: Number.NaN },
    { automaticAssignmentThreshold: Number.POSITIVE_INFINITY, reviewThreshold: 0.65 },
    { automaticAssignmentThreshold: 0.9, reviewThreshold: Number.POSITIVE_INFINITY },
  ])("rejects invalid policy %#", (policy) => {
    expect(() => validateEmployerClusterAssignmentPolicy(policy)).toThrow(
      "0 <= reviewThreshold <= automaticAssignmentThreshold <= 1",
    );
  });
});
