import { describe, expect, it } from "vitest";

import { employerRecognitionCases } from "../../validation/employer-recognition/cases/index.js";
import { employerRecognitionFixtures } from "../../validation/employer-recognition/fixtures/index.js";
import {
  runEmployerRecognitionValidation,
  scoreRecognitionValidationOutcome,
  summarizeRecognitionValidation,
  type ActualConfidenceZone,
  type RecognitionValidationOutcome,
} from "../../validation/employer-recognition/runValidation.js";
import type {
  ExpectedConfidenceZone,
  ExpectedEmployerRelationship,
  RecognitionValidationCase,
} from "../../validation/employer-recognition/types.js";

function validationCase(
  expectedRelationship: ExpectedEmployerRelationship,
  expectedConfidenceZone: ExpectedConfidenceZone,
): RecognitionValidationCase {
  return {
    caseId: "synthetic-case",
    observationIds: ["left", "right"],
    expectedRelationship,
    expectedConfidenceZone,
    humanExplanation: "Synthetic scoring test.",
    status: "VERIFIED",
  };
}

describe("employer recognition validation harness", () => {
  it.each([
    ["SAME_EMPLOYER_CLUSTER", "AUTO_MATCH", "AUTO_MATCH", "PASS"],
    ["SAME_EMPLOYER_CLUSTER", "AUTO_MATCH", "REVIEW_REQUIRED", "FAIL"],
    ["DIFFERENT_EMPLOYERS", "NO_MATCH", "NO_MATCH", "PASS"],
    ["DIFFERENT_EMPLOYERS", "NO_MATCH", "REVIEW_REQUIRED", "FAIL"],
    ["POSSIBLE_SAME_EMPLOYER", "REVIEW_REQUIRED", "AUTO_MATCH", "FAIL"],
    ["POSSIBLE_SAME_EMPLOYER", "REVIEW_REQUIRED", "NO_MATCH", "FAIL"],
  ] as const)(
    "scores %s expecting %s with actual %s as %s",
    (relationship, expected, actual, outcome) => {
      expect(
        scoreRecognitionValidationOutcome(
          validationCase(relationship, expected),
          actual,
        ),
      ).toBe(outcome);
    },
  );

  it("always leaves insufficient-evidence UNSCORED regardless of actual zone", () => {
    const input = validationCase("INSUFFICIENT_EVIDENCE", "UNSCORED");
    const zones: readonly ActualConfidenceZone[] = [
      "AUTO_MATCH",
      "REVIEW_REQUIRED",
      "NO_MATCH",
    ];
    for (const zone of zones) {
      expect(scoreRecognitionValidationOutcome(input, zone)).toBe("UNSCORED");
    }
  });

  it("summarizes counts and excludes unscored cases from pass rate", () => {
    const outcomes: readonly RecognitionValidationOutcome[] = [
      "PASS",
      "PASS",
      "FAIL",
      "UNSCORED",
    ];
    expect(
      summarizeRecognitionValidation(outcomes.map((outcome) => ({ outcome }))),
    ).toEqual({
      totalCases: 4,
      scoredCases: 3,
      passedCases: 2,
      failedCases: 1,
      unscoredCases: 1,
      passRate: 2 / 3,
    });
  });

  it("defines a safe zero pass rate when no cases are scored", () => {
    expect(
      summarizeRecognitionValidation([{ outcome: "UNSCORED" }]),
    ).toMatchObject({ scoredCases: 0, passRate: 0 });
  });

  it("executes all current corpus cases and retains diagnostic structure", async () => {
    const run = await runEmployerRecognitionValidation();

    expect(run.summary).toMatchObject({
      totalCases: 12,
      scoredCases: 11,
      unscoredCases: 1,
    });
    expect(run.results).toHaveLength(12);
    for (const result of run.results) {
      expect(Number.isFinite(result.confidence)).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(["AUTO_MATCH", "REVIEW_REQUIRED", "NO_MATCH"]).toContain(
        result.actualConfidenceZone,
      );
      expect(["PASS", "FAIL", "UNSCORED"]).toContain(result.outcome);
      expect(result.leftEvidence.sourceObservationId.length).toBeGreaterThan(0);
      expect(result.rightEvidence.sourceObservationId.length).toBeGreaterThan(0);
      expect(result.comparison.positiveSignals).toBeInstanceOf(Array);
      expect(result.comparison.contradictions).toBeInstanceOf(Array);
      expect(result.assessment).toHaveProperty("identity.assessment");
      expect(result.assessment).toHaveProperty("geography.assessment");
      expect(result.assessment).toHaveProperty("characteristics.assessment");
      expect(result.assessment).toHaveProperty("intermediary.assessment");
    }
  });

  it("does not mutate corpus fixtures or cases and is deterministic", async () => {
    const snapshot = JSON.stringify({
      employerRecognitionCases,
      employerRecognitionFixtures,
    });

    const first = await runEmployerRecognitionValidation();
    const second = await runEmployerRecognitionValidation();

    expect(JSON.stringify({ employerRecognitionCases, employerRecognitionFixtures })).toBe(
      snapshot,
    );
    expect(second.summary).toEqual(first.summary);
    expect(
      second.results.map(({ caseId, confidence, actualConfidenceZone, outcome }) => ({
        caseId,
        confidence,
        actualConfidenceZone,
        outcome,
      })),
    ).toEqual(
      first.results.map(({ caseId, confidence, actualConfidenceZone, outcome }) => ({
        caseId,
        confidence,
        actualConfidenceZone,
        outcome,
      })),
    );
  });
});
