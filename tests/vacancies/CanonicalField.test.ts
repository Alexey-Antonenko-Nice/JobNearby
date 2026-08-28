import { describe, expect, it } from "vitest";

import { createCanonicalField } from "../../src/domain/vacancies/CanonicalField.js";
import { resolveCanonicalField } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";

const derivation = {
  algorithm: "test-canonicalizer",
  algorithmVersion: "1.0.0",
  derivedAt: new Date("2026-08-28T08:00:00.000Z"),
};
const evidenceIds = new Set(["e1", "e2", "e3"]);

describe("CanonicalField", () => {
  it("represents missing evidence as UNKNOWN without a false-like value", () => {
    const field = resolveCanonicalField([], evidenceIds, derivation);
    expect(field).toEqual({
      status: "UNKNOWN",
      supportingEvidenceIds: [],
      conflictingEvidenceIds: [],
      derivation,
    });
    expect("value" in field).toBe(false);
  });

  it("resolves one unique value and merges its evidence references", () => {
    const field = resolveCanonicalField(
      [
        { value: "REMOTE", supportingEvidenceIds: ["e1"] },
        { value: "REMOTE", supportingEvidenceIds: ["e2", "e1"] },
      ],
      evidenceIds,
      derivation,
    );
    expect(field).toMatchObject({
      status: "RESOLVED",
      value: "REMOTE",
      supportingEvidenceIds: ["e1", "e2"],
      conflictingEvidenceIds: [],
    });
  });

  it("preserves confidence only when equivalent candidates agree", () => {
    expect(
      resolveCanonicalField(
        [{ value: "OPEN", supportingEvidenceIds: ["e1"], confidence: 0.8 }],
        evidenceIds,
        derivation,
      ).confidence,
    ).toBe(0.8);
    expect(
      resolveCanonicalField(
        [
          { value: "OPEN", supportingEvidenceIds: ["e1"], confidence: 0.8 },
          { value: "OPEN", supportingEvidenceIds: ["e2"], confidence: 0.9 },
        ],
        evidenceIds,
        derivation,
      ).confidence,
    ).toBeUndefined();
  });

  it("preserves incompatible values as conflicted alternatives", () => {
    const field = resolveCanonicalField(
      [
        { value: "HYBRID", supportingEvidenceIds: ["e1"] },
        { value: "ON_SITE", supportingEvidenceIds: ["e2"] },
      ],
      evidenceIds,
      derivation,
    );
    expect(field.status).toBe("CONFLICTED");
    expect(field.alternatives).toEqual([
      { value: "HYBRID", supportingEvidenceIds: ["e1"] },
      { value: "ON_SITE", supportingEvidenceIds: ["e2"] },
    ]);
    expect(field.conflictingEvidenceIds).toEqual(["e1", "e2"]);
    expect("value" in field).toBe(false);
  });

  it.each(["PARTIAL", "AMBIGUOUS"] as const)(
    "allows a caller to represent %s without generic inference",
    (status) => {
      const field = createCanonicalField({
        status,
        alternatives: [
          { value: "candidate", supportingEvidenceIds: ["e1"] },
        ],
        supportingEvidenceIds: ["e1"],
        conflictingEvidenceIds: [],
        derivation,
      });
      expect(field.status).toBe(status);
    },
  );

  it("rejects invalid unknown and conflicted representations", () => {
    expect(() =>
      createCanonicalField({
        status: "UNKNOWN",
        value: false,
        supportingEvidenceIds: [],
        conflictingEvidenceIds: [],
        derivation,
      }),
    ).toThrow(/unknown canonical field/u);
    expect(() =>
      createCanonicalField({
        status: "CONFLICTED",
        alternatives: [{ value: "only", supportingEvidenceIds: ["e1"] }],
        supportingEvidenceIds: ["e1"],
        conflictingEvidenceIds: ["e1"],
        derivation,
      }),
    ).toThrow(/incompatible alternatives/u);
  });
});
