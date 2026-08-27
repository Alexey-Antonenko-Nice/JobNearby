import { describe, expect, it } from "vitest";

import { employerRecognitionCases } from "../../validation/employer-recognition/cases/index.js";
import { employerRecognitionFixtures } from "../../validation/employer-recognition/fixtures/index.js";

const validStatuses = new Set(["VERIFIED", "NEEDS_REVIEW", "OPEN"]);
const validConfidenceZones = new Set([
  "AUTO_MATCH",
  "REVIEW_REQUIRED",
  "NO_MATCH",
  "UNSCORED",
]);

describe("employer recognition validation corpus", () => {
  it("has unique case IDs", () => {
    const ids = employerRecognitionCases.map(({ caseId }) => caseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique fixture observation IDs", () => {
    const ids = employerRecognitionFixtures.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references exactly two existing observations per case", () => {
    const fixtureIds = new Set(employerRecognitionFixtures.map(({ id }) => id));
    for (const validationCase of employerRecognitionCases) {
      expect(validationCase.observationIds).toHaveLength(2);
      expect(validationCase.observationIds[0]).not.toBe(
        validationCase.observationIds[1],
      );
      for (const observationId of validationCase.observationIds) {
        expect(fixtureIds.has(observationId), validationCase.caseId).toBe(true);
      }
    }
  });

  it("requires a non-empty human explanation", () => {
    for (const validationCase of employerRecognitionCases) {
      expect(validationCase.humanExplanation.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses valid statuses and confidence zones", () => {
    for (const validationCase of employerRecognitionCases) {
      expect(validStatuses.has(validationCase.status)).toBe(true);
      expect(validConfidenceZones.has(validationCase.expectedConfidenceZone)).toBe(
        true,
      );
    }
  });

  it("reserves UNSCORED for insufficient-evidence cases", () => {
    for (const validationCase of employerRecognitionCases) {
      if (validationCase.expectedRelationship === "INSUFFICIENT_EVIDENCE") {
        expect(validationCase.expectedConfidenceZone).toBe("UNSCORED");
      } else {
        expect(validationCase.expectedConfidenceZone).not.toBe("UNSCORED");
      }
    }
  });

  it("contains no obvious personal candidate or application-form data", () => {
    const serialized = JSON.stringify(employerRecognitionFixtures).toLowerCase();
    const forbiddenPatterns = [
      /cv[_ -]?(?:file|filename)/u,
      /\.pdf\b/u,
      /@[a-z0-9.-]+\.[a-z]{2,}/u,
      /application[_ -]?form/u,
      /candidate[_ -]?(?:name|email|phone|address)/u,
    ];
    for (const pattern of forbiddenPatterns) {
      expect(serialized).not.toMatch(pattern);
    }
  });

  it("contains the intended initial benchmark breadth", () => {
    expect(employerRecognitionFixtures).toHaveLength(22);
    expect(employerRecognitionCases).toHaveLength(12);
  });
});
