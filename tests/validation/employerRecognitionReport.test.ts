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
    expect(report).toContain("- Passed: 9");
    expect(report).toContain("- Failed: 2");
    expect(report).toContain("- Unscored: 1");
    expect(report).toContain("- Pass rate: 81.8%");
    expect(report).toContain("`possible-anonymous-wood-energy`");
    expect(report).toContain("`possible-anonymous-precision-machining`");
  });

  it("renders PASS, FAIL, and UNSCORED cases", () => {
    expect(report).toMatch(
      /## Case: `same-loxam-business-units`[\s\S]*?- Outcome: `PASS`/u,
    );
    expect(report).toMatch(
      /## Case: `possible-anonymous-wood-energy`[\s\S]*?- Outcome: `FAIL`/u,
    );
    expect(report).toMatch(
      /## Case: `insufficient-generic-maintenance`[\s\S]*?- Outcome: `UNSCORED`/u,
    );
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

  it("classifies the two current failures as likely extraction gaps", () => {
    const failures = run.results.filter(({ outcome }) => outcome === "FAIL");
    expect(failures.map(({ caseId }) => caseId)).toEqual([
      "possible-anonymous-wood-energy",
      "possible-anonymous-precision-machining",
    ]);
    for (const failure of failures) {
      expect(classifyValidationDiagnostic(failure).category).toBe(
        "LIKELY_EXTRACTION_GAP",
      );
    }
    expect(report.match(/Category: `LIKELY_EXTRACTION_GAP`/gu)).toHaveLength(2);
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
