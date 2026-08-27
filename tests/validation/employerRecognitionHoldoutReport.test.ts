import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

  it("preserves the first independent evaluation as an immutable historical report", () => {
    const baseline = readFileSync(
      join(
        process.cwd(),
        "validation",
        "employer-recognition-holdout",
        "BASELINE_REPORT.md",
      ),
      "utf8",
    );
    expect(createHash("sha256").update(baseline).digest("hex")).toBe(
      "a368470caabf097194263fb7fde47aa0758a4878a1a13e2ade4f35fc1823b4b2",
    );
    expect(baseline).toContain("- Passed: 5");
    expect(baseline).toContain("- Pass rate: 55.6%");
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
