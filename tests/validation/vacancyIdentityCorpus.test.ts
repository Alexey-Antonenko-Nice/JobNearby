import { describe, expect, it } from "vitest";

import { DirectFieldVacancyEvidenceExtractor } from "../../src/application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { compareVacancyIdentity } from "../../src/domain/vacancy-identity/compareVacancyIdentity.js";
import { vacancyIdentityValidationCases } from "../../validation/vacancy-identity/cases/index.js";
import { vacancyIdentityValidationFixtures } from "../../validation/vacancy-identity/fixtures/index.js";

describe("vacancy identity exact-ID validation corpus", () => {
  it("contains two unique cases and four independent fixtures", () => {
    expect(vacancyIdentityValidationCases.map(({ caseId }) => caseId)).toEqual(["V01", "V02"]);
    expect(vacancyIdentityValidationFixtures).toHaveLength(4);
    expect(new Set(vacancyIdentityValidationFixtures.map(({ id }) => id)).size).toBe(4);
  });

  it("executes V01 and V02 as SAME_VACANCY without mutating observations", async () => {
    const snapshot = JSON.stringify({
      vacancyIdentityValidationCases,
      vacancyIdentityValidationFixtures,
    });
    const fixtures = new Map(
      vacancyIdentityValidationFixtures.map((fixture) => [fixture.id, fixture]),
    );
    const extractor = new DirectFieldVacancyEvidenceExtractor();

    for (const validationCase of vacancyIdentityValidationCases) {
      const left = fixtures.get(validationCase.observationIds[0])!;
      const right = fixtures.get(validationCase.observationIds[1])!;
      expect(left).not.toBe(right);
      const comparison = compareVacancyIdentity(
        await extractor.extract(left),
        await extractor.extract(right),
      );
      expect(comparison).toMatchObject({
        result: validationCase.expectedResult,
        reason: "EXACT_PROVIDER_EXTERNAL_ID_MATCH",
        leftObservationId: left.id,
        rightObservationId: right.id,
      });
    }

    expect(JSON.stringify({ vacancyIdentityValidationCases, vacancyIdentityValidationFixtures })).toBe(snapshot);
  });
});
