import { describe, expect, it } from "vitest";

import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { compareVacancyIdentity } from "../../src/domain/vacancy-identity/compareVacancyIdentity.js";

function evidence(
  observationId: string,
  identifiers: readonly { value: string; provider: string }[] = [],
  organization?: string,
) {
  const provenance = {
    sourceObservationId: observationId,
    extractionMethod: "DIRECT_FIELD" as const,
    confidence: 1,
  };
  return createExtractedVacancyEvidence({
    sourceObservationId: observationId,
    ...(organization === undefined
      ? {}
      : {
          organizations: [
            { value: organization, role: "UNKNOWN" as const, provenance },
          ],
        }),
    externalIdentifiers: identifiers.map(({ value, provider }) => ({
      value,
      provider,
      identifierType: "SOURCE_EXTERNAL_ID",
      provenance,
    })),
  });
}

describe("compareVacancyIdentity", () => {
  it("decisively matches the same external ID in the same provider namespace", () => {
    const left = evidence("capture-a", [{ provider: "Indeed", value: "ABC123" }]);
    const right = evidence("capture-b", [{ provider: "Indeed", value: "ABC123" }]);

    expect(compareVacancyIdentity(left, right)).toEqual({
      result: "SAME_VACANCY",
      reason: "EXACT_PROVIDER_EXTERNAL_ID_MATCH",
      leftObservationId: "capture-a",
      rightObservationId: "capture-b",
      matchedExternalIdentifier: {
        providerNamespace: "indeed",
        value: "ABC123",
        leftEvidence: left.externalIdentifiers[0],
        rightEvidence: right.externalIdentifiers[0],
      },
    });
  });

  it("normalizes provider case and whitespace conservatively", () => {
    const comparison = compareVacancyIdentity(
      evidence("left", [{ provider: " Indeed  Jobs ", value: "ABC123" }]),
      evidence("right", [{ provider: "indeed jobs", value: "ABC123" }]),
    );
    expect(comparison).toMatchObject({
      result: "SAME_VACANCY",
      matchedExternalIdentifier: { providerNamespace: "indeed jobs" },
    });
  });

  it("does not treat the same external ID across providers as sufficient", () => {
    expect(
      compareVacancyIdentity(
        evidence("left", [{ provider: "Indeed", value: "ABC123" }]),
        evidence("right", [{ provider: "FranceTravail", value: "ABC123" }]),
      ),
    ).toEqual({
      result: "UNRESOLVED",
      reason: "PROVIDER_NAMESPACE_MISMATCH",
      leftObservationId: "left",
      rightObservationId: "right",
    });
  });

  it("leaves different IDs from the same provider unresolved", () => {
    expect(
      compareVacancyIdentity(
        evidence("left", [{ provider: "Indeed", value: "ABC123" }]),
        evidence("right", [{ provider: "Indeed", value: "XYZ789" }]),
      ),
    ).toMatchObject({ result: "UNRESOLVED", reason: "EXTERNAL_ID_MISMATCH" });
  });

  it.each([
    [[], [{ provider: "Indeed", value: "ABC123" }]],
    [[], []],
  ] as const)("leaves missing external-ID evidence unresolved", (left, right) => {
    expect(
      compareVacancyIdentity(evidence("left", left), evidence("right", right)),
    ).toMatchObject({ result: "UNRESOLVED", reason: "MISSING_EXTERNAL_ID" });
  });

  it("does not merge the same employer when external IDs differ", () => {
    const left = evidence("schindler-role-a", [{ provider: "Indeed", value: "role-a" }], "Schindler France");
    const right = evidence("schindler-role-b", [{ provider: "Indeed", value: "role-b" }], "Schindler France");
    expect(compareVacancyIdentity(left, right).result).toBe("UNRESOLVED");
  });

  it("ignores similar titles and different displayed employers because they are not identity evidence", () => {
    const left = evidence("maintenance-technician-a", [{ provider: "Indeed", value: "id-a" }], "Employer A");
    const right = evidence("maintenance-technician-b", [{ provider: "Indeed", value: "id-b" }], "Employer B");
    expect(compareVacancyIdentity(left, right)).toMatchObject({
      result: "UNRESOLVED",
      reason: "EXTERNAL_ID_MISMATCH",
    });
  });

  it("is deterministic and does not mutate either evidence aggregate", () => {
    const left = evidence("capture-a", [{ provider: "Indeed", value: "stable-id" }]);
    const right = evidence("capture-b", [{ provider: "Indeed", value: "stable-id" }]);
    const snapshot = JSON.stringify({ left, right });
    const first = compareVacancyIdentity(left, right);
    const second = compareVacancyIdentity(left, right);

    expect(second).toEqual(first);
    expect(JSON.stringify({ left, right })).toBe(snapshot);
    expect(left).not.toBe(right);
    expect(left.sourceObservationId).not.toBe(right.sourceObservationId);
  });
});
