import { beforeAll, describe, expect, it } from "vitest";

import { employerRecognitionFixtures } from "../../validation/employer-recognition/fixtures/index.js";
import {
  classifyValidationDiagnostic,
  renderEmployerRecognitionValidationReport,
} from "../../validation/employer-recognition/renderReport.js";
import {
  runEmployerRecognitionValidation,
  type RecognitionValidationRun,
} from "../../validation/employer-recognition/runValidation.js";

describe("employer recognition explainability report", () => {
  let run: RecognitionValidationRun;
  let report: string;

  beforeAll(async () => {
    run = await runEmployerRecognitionValidation();
    report = renderEmployerRecognitionValidationReport(run);
  });

  it("renders deterministic Markdown without mutating the validation run", () => {
    const snapshot = JSON.stringify(run);
    const second = renderEmployerRecognitionValidationReport(run);

    expect(second).toBe(report);
    expect(JSON.stringify(run)).toBe(snapshot);
    expect(report).toMatch(/^# Employer Recognition Validation Report\n/u);
  });

  it("derives the current summary and failed case IDs", () => {
    expect(report).toContain("- Total cases: 12");
    expect(report).toContain("- Scored cases: 11");
    expect(report).toContain("- Passed: 11");
    expect(report).toContain("- Failed: 0");
    expect(report).toContain("- Unscored: 1");
    expect(report).toContain("- Pass rate: 100.0%");
    expect(report).toContain("- Failed case IDs: None.");
  });

  it("renders PASS and UNSCORED cases from the improved corpus", () => {
    expect(report).toMatch(
      /## Case: `same-loxam-business-units`[\s\S]*?- Outcome: `PASS`/u,
    );
    expect(report).toMatch(
      /## Case: `possible-anonymous-wood-energy`[\s\S]*?- Outcome: `PASS`/u,
    );
    expect(report).toMatch(
      /## Case: `insufficient-generic-maintenance`[\s\S]*?- Outcome: `UNSCORED`/u,
    );
  });

  it("continues to render a structured FAIL result", () => {
    const failedResult = {
      ...run.results[0]!,
      outcome: "FAIL" as const,
      expectedConfidenceZone: "REVIEW_REQUIRED" as const,
      actualConfidenceZone: "NO_MATCH" as const,
    };
    const failedReport = renderEmployerRecognitionValidationReport({
      results: [failedResult],
      summary: {
        totalCases: 1,
        scoredCases: 1,
        passedCases: 0,
        failedCases: 1,
        unscoredCases: 0,
        passRate: 0,
      },
    });
    expect(failedReport).toContain("- Outcome: `FAIL`");
  });

  it("renders evidence groups, semantic metadata, and empty states", () => {
    expect(report).toContain("##### Organizations");
    expect(report).toContain("##### Locations");
    expect(report).toContain("##### People");
    expect(report).toContain("##### Employer characteristics");
    expect(report).toContain("##### External identifiers");
    expect(report).toContain("LOXAM — role: `EMPLOYER`");
    expect(report).toContain("Strasbourg — role: `DISPLAYED_LOCATION`");
    expect(report).toContain(
      "ROBOPAC distributor — category: `DISTINCTIVE_FACT`; specificity: `VERY_HIGH`",
    );
    expect(report).toContain("method: `TEXT_EXTRACTION`; confidence: 0.98");
    expect(report).toContain("None extracted.");
  });

  it("renders positive signals, contradictions, and all dimensions", () => {
    expect(report).toContain("#### Positive signals");
    expect(report).toMatch(/- \[VERY_STRONG\] Same explicit employer/u);
    expect(report).toContain("#### Contradictions");
    expect(report).toMatch(/- \[(?:STRONG|DECISIVE)\]/u);
    expect(report).toContain("- Identity: `");
    expect(report).toContain("- Geography: `");
    expect(report).toContain("- Characteristics: `");
    expect(report).toContain("- Intermediary: `");
  });

  it("shows both formerly failing extraction-gap cases as expected behavior", () => {
    const targets = run.results.filter(({ caseId }) =>
      [
      "possible-anonymous-wood-energy",
      "possible-anonymous-precision-machining",
      ].includes(caseId),
    );
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      expect(target.outcome).toBe("PASS");
      expect(classifyValidationDiagnostic(target).category).toBe(
        "EXPECTED_BEHAVIOR",
      );
    }
  });

  it("classifies overconfidence and underconfidence conservatively", () => {
    const base = run.results[0]!;
    expect(
      classifyValidationDiagnostic({
        ...base,
        outcome: "FAIL",
        expectedConfidenceZone: "REVIEW_REQUIRED",
        actualConfidenceZone: "AUTO_MATCH",
      }).category,
    ).toBe("OVERCONFIDENT");
    expect(
      classifyValidationDiagnostic({
        ...base,
        outcome: "FAIL",
        expectedConfidenceZone: "AUTO_MATCH",
        actualConfidenceZone: "REVIEW_REQUIRED",
      }).category,
    ).toBe("UNDERCONFIDENT");
  });

  it("renders every corpus case once and does not dump complete fixture text", () => {
    expect(report.match(/^## Case: /gmu)).toHaveLength(12);
    for (const fixture of employerRecognitionFixtures) {
      if (fixture.description !== undefined) {
        expect(report).not.toContain(fixture.description);
      }
      if (fixture.rawContent !== undefined) {
        expect(report).not.toContain(fixture.rawContent);
      }
    }
  });

  it("escapes benchmark text that could create Markdown structure", () => {
    const unsafeRun: RecognitionValidationRun = {
      summary: run.summary,
      results: [
        {
          ...run.results[0]!,
          caseId: "unsafe\n## heading",
          humanExplanation: "**bold** | injected\n# heading",
        },
      ],
    };
    const unsafeReport = renderEmployerRecognitionValidationReport(unsafeRun);

    expect(unsafeReport).not.toContain("\n## heading");
    expect(unsafeReport).not.toContain("**bold**");
    expect(unsafeReport).toContain("\\*\\*bold\\*\\*");
  });
});
