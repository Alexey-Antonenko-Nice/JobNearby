import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { employerRecognitionHoldoutCases } from "../../validation/employer-recognition-holdout/cases/index.js";
import { employerRecognitionHoldoutFixtures } from "../../validation/employer-recognition-holdout/fixtures/index.js";
import {
  classifyHoldoutDiagnostic,
  renderEmployerRecognitionHoldoutReport,
} from "../../validation/employer-recognition-holdout/renderReport.js";
import {
  runEmployerRecognitionHoldoutEvaluation,
  type EmployerRecognitionHoldoutRun,
} from "../../validation/employer-recognition-holdout/runEvaluation.js";
import { employerRecognitionCases } from "../../validation/employer-recognition/cases/index.js";
import { employerRecognitionFixtures } from "../../validation/employer-recognition/fixtures/index.js";

describe("independent employer recognition holdout evaluation", () => {
  let run: EmployerRecognitionHoldoutRun;

  beforeAll(async () => {
    run = await runEmployerRecognitionHoldoutEvaluation();
  });

  it("executes all ten frozen cases with nine scored and one unscored", () => {
    expect(run.results).toHaveLength(10);
    expect(run.summary).toMatchObject({
      totalCases: 10,
      scoredCases: 9,
      unscoredCases: 1,
    });
    expect(run.results.map(({ caseId }) => caseId)).toEqual(
      employerRecognitionHoldoutCases.map(({ caseId }) => caseId),
    );
  });

  it("excludes the unscored case from the calculated pass rate", () => {
    expect(run.summary.passedCases + run.summary.failedCases).toBe(9);
    expect(run.summary.passRate).toBe(
      run.summary.passedCases / run.summary.scoredCases,
    );
    const unscored = run.results.filter(({ outcome }) => outcome === "UNSCORED");
    expect(unscored).toHaveLength(1);
    expect(unscored[0]).toMatchObject({
      expectedRelationship: "INSUFFICIENT_EVIDENCE",
      expectedConfidenceZone: "UNSCORED",
    });
  });

  it("scores expected versus actual zones without rewriting either value", () => {
    const casesById = new Map(
      employerRecognitionHoldoutCases.map((holdoutCase) => [holdoutCase.caseId, holdoutCase]),
    );
    for (const result of run.results) {
      const holdoutCase = casesById.get(result.caseId)!;
      expect(result.expectedConfidenceZone).toBe(holdoutCase.expectedConfidenceZone);
      const expectedOutcome = holdoutCase.expectedConfidenceZone === "UNSCORED"
        ? "UNSCORED"
        : holdoutCase.expectedConfidenceZone === result.actualConfidenceZone
          ? "PASS"
          : "FAIL";
      expect(result.outcome).toBe(expectedOutcome);
    }
  });

  it("is deterministic and leaves frozen fixtures and labels immutable", async () => {
    const frozenData = JSON.stringify({
      employerRecognitionHoldoutCases,
      employerRecognitionHoldoutFixtures,
    });
    const second = await runEmployerRecognitionHoldoutEvaluation();

    expect(JSON.stringify({ employerRecognitionHoldoutCases, employerRecognitionHoldoutFixtures })).toBe(frozenData);
    expect(second).toEqual(run);
  });

  it("retains the full validation-only diagnostic structure", () => {
    for (const result of run.results) {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.leftEvidence.sourceObservationId).toBe(
        employerRecognitionHoldoutCases.find(({ caseId }) => caseId === result.caseId)!.observationIds[0],
      );
      expect(result.rightEvidence.sourceObservationId).toBe(
        employerRecognitionHoldoutCases.find(({ caseId }) => caseId === result.caseId)!.observationIds[1],
      );
      expect(result.comparison.positiveSignals).toBeInstanceOf(Array);
      expect(result.comparison.contradictions).toBeInstanceOf(Array);
      expect(result.assessment).toHaveProperty("identity.assessment");
      expect(result.assessment).toHaveProperty("geography.assessment");
      expect(result.assessment).toHaveProperty("characteristics.assessment");
      expect(result.assessment).toHaveProperty("intermediary.assessment");
      expect(classifyHoldoutDiagnostic(result).category.length).toBeGreaterThan(0);
    }
  });

  it("keeps holdout and regression records separate", () => {
    const regressionCaseIds = new Set(employerRecognitionCases.map(({ caseId }) => caseId));
    const regressionFixtureIds = new Set(employerRecognitionFixtures.map(({ id }) => id));
    for (const holdoutCase of employerRecognitionHoldoutCases) expect(regressionCaseIds.has(holdoutCase.caseId)).toBe(false);
    for (const fixture of employerRecognitionHoldoutFixtures) expect(regressionFixtureIds.has(fixture.id)).toBe(false);
  });

  it("uses production recognition read-only from validation code", () => {
    const evaluator = readFileSync(
      join(process.cwd(), "validation", "employer-recognition-holdout", "runEvaluation.ts"),
      "utf8",
    );
    expect(evaluator).not.toMatch(
      /from ["']\.\.\/employer-recognition\/(?:cases|fixtures)\/index/u,
    );
    expect(evaluator).toContain("./cases/index.js");
    expect(evaluator).toContain("./fixtures/index.js");
    expect(evaluator).not.toMatch(/writeFile|appendFile|rename|unlink/u);
  });
});
