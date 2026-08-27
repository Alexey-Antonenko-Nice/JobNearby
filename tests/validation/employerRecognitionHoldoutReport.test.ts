import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { employerRecognitionHoldoutFixtures } from "../../validation/employer-recognition-holdout/fixtures/index.js";
import {
  classifyHoldoutDiagnostic,
  renderEmployerRecognitionHoldoutReport,
} from "../../validation/employer-recognition-holdout/renderReport.js";
import {
  runEmployerRecognitionHoldoutEvaluation,
  type EmployerRecognitionHoldoutRun,
} from "../../validation/employer-recognition-holdout/runEvaluation.js";

describe("independent employer recognition holdout report", () => {
  let run: EmployerRecognitionHoldoutRun;
  let report: string;

  beforeAll(async () => {
    run = await runEmployerRecognitionHoldoutEvaluation();
    report = renderEmployerRecognitionHoldoutReport(run);
  });

  it("renders deterministic Markdown with a derived summary and failure list", () => {
    expect(renderEmployerRecognitionHoldoutReport(run)).toBe(report);
    expect(report).toMatch(/^# Independent Employer Recognition Holdout Evaluation\n/u);
    expect(report).toContain("- Total cases: 10");
    expect(report).toContain("- Scored cases: 9");
    expect(report).toContain(`- Passed: ${run.summary.passedCases}`);
    expect(report).toContain(`- Failed: ${run.summary.failedCases}`);
    expect(report).toContain(`- Pass rate: ${(run.summary.passRate * 100).toFixed(1)}%`);
    for (const result of run.results.filter(({ outcome }) => outcome === "FAIL")) {
      expect(report).toContain(`\`${result.caseId}\``);
    }
  });

  it("preserves the first independent evaluation as an exact baseline report", () => {
    const baseline = readFileSync(
      join(
        process.cwd(),
        "validation",
        "employer-recognition-holdout",
        "BASELINE_REPORT.md",
      ),
      "utf8",
    );
    expect(report).toBe(baseline);
  });

  it("renders every case with evidence, comparison, dimensions, and diagnostics", () => {
    expect(report.match(/^## Case: /gmu)).toHaveLength(10);
    for (const result of run.results) {
      expect(report).toContain(`## Case: \`${result.caseId}\``);
      expect(report).toContain(`- Numeric confidence: ${result.confidence.toFixed(2)}`);
      expect(report).toContain(`- Category: \`${classifyHoldoutDiagnostic(result).category}\``);
    }
    expect(report).toContain("### Observed facts");
    expect(report).toContain("#### Positive signals");
    expect(report).toContain("#### Contradictions");
    expect(report).toContain("### Dimension assessments");
  });

  it("does not dump full vacancy descriptions", () => {
    for (const fixture of employerRecognitionHoldoutFixtures) {
      if (fixture.description !== undefined) expect(report).not.toContain(fixture.description);
      if (fixture.rawContent !== undefined) expect(report).not.toContain(fixture.rawContent);
    }
  });
});
