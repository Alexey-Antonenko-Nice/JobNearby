import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { employerRecognitionHoldoutCases } from "../../validation/employer-recognition-holdout/cases/index.js";
import { employerRecognitionHoldoutFixtures } from "../../validation/employer-recognition-holdout/fixtures/index.js";
import { employerRecognitionCases } from "../../validation/employer-recognition/cases/index.js";
import { employerRecognitionFixtures } from "../../validation/employer-recognition/fixtures/index.js";

const validRelationships = new Set([
  "SAME_EMPLOYER_CLUSTER",
  "DIFFERENT_EMPLOYERS",
  "POSSIBLE_SAME_EMPLOYER",
  "INSUFFICIENT_EVIDENCE",
]);
const validZones = new Set(["AUTO_MATCH", "REVIEW_REQUIRED", "NO_MATCH", "UNSCORED"]);

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? typescriptFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("independent employer recognition holdout corpus", () => {
  it("contains exactly ten holdout cases with unique IDs", () => {
    expect(employerRecognitionHoldoutCases).toHaveLength(10);
    expect(new Set(employerRecognitionHoldoutCases.map(({ caseId }) => caseId)).size).toBe(10);
  });

  it("has unique fixture IDs", () => {
    const ids = employerRecognitionHoldoutFixtures.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references exactly two existing distinct fixtures per case", () => {
    const fixtureIds = new Set(employerRecognitionHoldoutFixtures.map(({ id }) => id));
    for (const holdoutCase of employerRecognitionHoldoutCases) {
      expect(holdoutCase.observationIds).toHaveLength(2);
      expect(holdoutCase.observationIds[0]).not.toBe(holdoutCase.observationIds[1]);
      for (const observationId of holdoutCase.observationIds) {
        expect(fixtureIds.has(observationId), holdoutCase.caseId).toBe(true);
      }
    }
  });

  it("uses valid relationships, zones, and non-empty human rationales", () => {
    for (const holdoutCase of employerRecognitionHoldoutCases) {
      expect(validRelationships.has(holdoutCase.expectedRelationship)).toBe(true);
      expect(validZones.has(holdoutCase.expectedConfidenceZone)).toBe(true);
      expect(holdoutCase.humanExplanation.trim().length).toBeGreaterThan(0);
    }
  });

  it("reserves UNSCORED for insufficient evidence and scores every other case", () => {
    for (const holdoutCase of employerRecognitionHoldoutCases) {
      expect(holdoutCase.expectedConfidenceZone === "UNSCORED").toBe(
        holdoutCase.expectedRelationship === "INSUFFICIENT_EVIDENCE",
      );
    }
  });

  it("contains no obvious candidate or application data", () => {
    const serialized = JSON.stringify(employerRecognitionHoldoutFixtures).toLowerCase();
    const forbiddenPatterns = [
      /cv[_ -]?(?:file|filename)/u,
      /\.pdf\b/u,
      /@[a-z0-9.-]+\.[a-z]{2,}/u,
      /application[_ -]?form/u,
      /candidate[_ -]?(?:name|email|phone|address)/u,
      /(?:first|last)[_ -]?name/u,
    ];
    for (const pattern of forbiddenPatterns) expect(serialized).not.toMatch(pattern);
  });

  it("remains structurally separate from the regression corpus", () => {
    const regressionFixtureIds = new Set(employerRecognitionFixtures.map(({ id }) => id));
    const regressionCaseIds = new Set(employerRecognitionCases.map(({ caseId }) => caseId));
    for (const fixture of employerRecognitionHoldoutFixtures) expect(regressionFixtureIds.has(fixture.id)).toBe(false);
    for (const holdoutCase of employerRecognitionHoldoutCases) expect(regressionCaseIds.has(holdoutCase.caseId)).toBe(false);
  });

  it("is not imported by production code", () => {
    for (const path of typescriptFiles(join(process.cwd(), "src"))) {
      expect(readFileSync(path, "utf8"), path).not.toContain("employer-recognition-holdout");
    }
  });
});
