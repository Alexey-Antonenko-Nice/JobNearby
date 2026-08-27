import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { employerRecognitionHoldoutCases } from "../../validation/employer-recognition-holdout/cases/index.js";
import {
  diagnoseHoldoutFailures,
  holdoutFailureDiagnoses,
} from "../../validation/employer-recognition-holdout/failureDiagnosis.js";
import { employerRecognitionHoldoutFixtures } from "../../validation/employer-recognition-holdout/fixtures/index.js";
import { renderHoldoutFailureDiagnosisReport } from "../../validation/employer-recognition-holdout/renderFailureDiagnosis.js";
import { renderEmployerRecognitionHoldoutReport } from "../../validation/employer-recognition-holdout/renderReport.js";
import {
  runEmployerRecognitionHoldoutEvaluation,
  type EmployerRecognitionHoldoutRun,
} from "../../validation/employer-recognition-holdout/runEvaluation.js";

describe("employer recognition holdout failure diagnosis", () => {
  let run: EmployerRecognitionHoldoutRun;
  let report: string;

  beforeAll(async () => {
    run = await runEmployerRecognitionHoldoutEvaluation();
    report = renderHoldoutFailureDiagnosisReport(run);
  });

  it("diagnoses exactly the four frozen failures with an earliest stage", () => {
    const diagnoses = diagnoseHoldoutFailures(run.results);
    expect(diagnoses.map(({ caseId }) => caseId)).toEqual(["H01", "H02", "H07", "H09"]);
    expect(holdoutFailureDiagnoses).toHaveLength(4);
    for (const diagnosis of diagnoses) {
      expect(diagnosis.earliestFailureStage.length).toBeGreaterThan(0);
      expect(diagnosis.observedCause.length).toBeGreaterThan(0);
      expect(diagnosis.engineeringHypothesis.length).toBeGreaterThan(0);
      expect(diagnosis.observedCause).not.toBe(diagnosis.engineeringHypothesis);
    }
  });

  it("exposes H02's actual organizations without inventing a parent relationship", () => {
    const h02 = run.results.find(({ caseId }) => caseId === "H02")!;
    const diagnosis = holdoutFailureDiagnoses.find(({ caseId }) => caseId === "H02")!;
    expect(h02.leftEvidence.organizations).toMatchObject([
      { value: "LOXAM", role: "UNKNOWN", provenance: { extractionMethod: "DIRECT_FIELD", confidence: 1 } },
    ]);
    expect(h02.rightEvidence.organizations).toMatchObject([
      { value: "LOXAM", role: "UNKNOWN", provenance: { extractionMethod: "DIRECT_FIELD", confidence: 1 } },
    ]);
    expect(h02.comparison.positiveSignals).toContainEqual(
      expect.objectContaining({ kind: "EMPLOYER_IDENTITY", strength: "STRONG" }),
    );
    expect(h02.assessment.identity.assessment).toBe("STRONG_POSITIVE");
    expect(diagnosis.earliestFailureStage).toBe("COMPARISON");
    expect(diagnosis.engineeringHypothesis).toContain("not a normalization, alias, or parent-brand/business-unit failure");
    expect(report).not.toMatch(/shared LOXAM parent (?:is|was|exists)/iu);
  });

  it("records the H01 evidence that actually survived extraction", () => {
    const h01 = run.results.find(({ caseId }) => caseId === "H01")!;
    expect(h01.leftEvidence.locations).toMatchObject([{ value: "Strasbourg", role: "DISPLAYED_LOCATION" }]);
    expect(h01.rightEvidence.locations).toMatchObject([{ value: "Strasbourg", role: "DISPLAYED_LOCATION" }]);
    expect(h01.leftEvidence.externalIdentifiers).toHaveLength(1);
    expect(h01.rightEvidence.externalIdentifiers).toHaveLength(1);
    expect(h01.leftEvidence.employerCharacteristics).toHaveLength(0);
    expect(h01.rightEvidence.employerCharacteristics).toHaveLength(0);
    expect(report).toContain("4454269228 / Indeed / DIRECT_FIELD / 1.00");
  });

  it("distinguishes H07 job similarity from employer evidence", () => {
    const h07 = holdoutFailureDiagnoses.find(({ caseId }) => caseId === "H07")!;
    for (const clue of ["Maintenance", "Repair", "Regulatory controls"]) {
      expect(h07.humanSignals.find((signal) => signal.clue === clue)?.attribution).toBe("JOB_OR_OCCUPATION_CONTEXT");
    }
    expect(h07.engineeringHypothesis).toContain("cannot alone establish employer identity");
  });

  it("distinguishes H09 employer context, duties, and absent claims", () => {
    const h09 = holdoutFailureDiagnoses.find(({ caseId }) => caseId === "H09")!;
    expect(h09.humanSignals.find(({ clue }) => clue === "Production site")?.attribution).toBe("EMPLOYER_CHARACTERISTIC");
    expect(h09.humanSignals.find(({ clue }) => clue === "GMAO")?.attribution).toBe("JOB_OR_OCCUPATION_CONTEXT");
    expect(h09.humanSignals.find(({ clue }) => clue === "Explicit 5x8 organization")?.attribution).toBe("ABSENT");
    expect(h09.humanSignals.find(({ clue }) => clue === "Energy / boiler rounds")?.attribution).toBe("ABSENT");
  });

  it("generates the diagnosis deterministically and separates facts from interpretation", () => {
    expect(renderHoldoutFailureDiagnosisReport(run)).toBe(report);
    const preservedDiagnosis = readFileSync(
      join(process.cwd(), "validation", "employer-recognition-holdout", "FAILURE_DIAGNOSIS.md"),
      "utf8",
    );
    expect(createHash("sha256").update(preservedDiagnosis).digest("hex")).toBe(
      "99eb8dccb7bf84db2ed2165eed16e595eb141e226d38479accd5c169cb604faa",
    );
    expect(report).toContain("### Observed pipeline facts");
    expect(report).toContain("### Engineering interpretation");
    expect(report.match(/^## H(?:01|02|07|09)$/gmu)).toHaveLength(4);
  });

  it("does not mutate holdout fixtures or labels", async () => {
    const snapshot = JSON.stringify({ employerRecognitionHoldoutCases, employerRecognitionHoldoutFixtures });
    await runEmployerRecognitionHoldoutEvaluation();
    expect(JSON.stringify({ employerRecognitionHoldoutCases, employerRecognitionHoldoutFixtures })).toBe(snapshot);
  });

  it("keeps the preserved baseline report byte-for-byte unchanged", () => {
    const baseline = readFileSync(
      join(process.cwd(), "validation", "employer-recognition-holdout", "BASELINE_REPORT.md"),
      "utf8",
    );
    expect(createHash("sha256").update(baseline).digest("hex")).toBe(
      "a368470caabf097194263fb7fde47aa0758a4878a1a13e2ade4f35fc1823b4b2",
    );
  });
});
