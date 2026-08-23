import { describe, expect, it } from "vitest";

import type {
  DimensionAssessment,
  EmployerMatchAssessment,
} from "../../src/domain/recognition/EmployerMatchAssessment.js";
import { calculateEmployerMatchConfidence } from "../../src/domain/recognition/calculateEmployerMatchConfidence.js";

function assessment(
  identity: DimensionAssessment,
  geography: DimensionAssessment,
  characteristics: DimensionAssessment,
  intermediary: DimensionAssessment,
): EmployerMatchAssessment {
  const dimension = (value: DimensionAssessment) => ({
    assessment: value,
    supportingSignals: [],
    contradictions: [],
  });
  return {
    identity: dimension(identity),
    geography: dimension(geography),
    characteristics: dimension(characteristics),
    intermediary: dimension(intermediary),
  };
}

const goldenCases = [
  ["VERY_STRONG_POSITIVE", "UNKNOWN", "UNKNOWN", "UNKNOWN", 0.95],
  ["VERY_STRONG_POSITIVE", "MEDIUM_POSITIVE", "STRONG_POSITIVE", "UNKNOWN", 0.98],
  ["UNKNOWN", "MEDIUM_POSITIVE", "VERY_STRONG_POSITIVE", "UNKNOWN", 0.91],
  ["UNKNOWN", "UNKNOWN", "VERY_STRONG_POSITIVE", "UNKNOWN", 0.84],
  ["UNKNOWN", "MEDIUM_POSITIVE", "STRONG_POSITIVE", "WEAK_POSITIVE", 0.8],
  ["UNKNOWN", "WEAK_POSITIVE", "STRONG_POSITIVE", "UNKNOWN", 0.72],
  ["UNKNOWN", "MEDIUM_POSITIVE", "UNKNOWN", "WEAK_POSITIVE", 0.48],
  ["UNKNOWN", "WEAK_POSITIVE", "UNKNOWN", "WEAK_POSITIVE", 0.3],
  ["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", 0.1],
  ["UNKNOWN", "MEDIUM_POSITIVE", "STRONG_NEGATIVE", "WEAK_POSITIVE", 0.2],
  ["DECISIVE_NEGATIVE", "STRONG_POSITIVE", "VERY_STRONG_POSITIVE", "WEAK_POSITIVE", 0.02],
  ["UNKNOWN", "UNKNOWN", "STRONG_POSITIVE", "UNKNOWN", 0.67],
  ["VERY_STRONG_POSITIVE", "MEDIUM_POSITIVE", "STRONG_NEGATIVE", "UNKNOWN", 0.8],
] as const satisfies readonly (readonly [
  DimensionAssessment,
  DimensionAssessment,
  DimensionAssessment,
  DimensionAssessment,
  number,
])[];

describe("calculateEmployerMatchConfidence", () => {
  it.each(goldenCases)(
    "calibrates %s / %s / %s / %s to %s",
    (identity, geography, characteristics, intermediary, expected) => {
      expect(
        calculateEmployerMatchConfidence(
          assessment(identity, geography, characteristics, intermediary),
        ),
      ).toBe(expected);
    },
  );

  it("keeps every golden result finite and within the confidence range", () => {
    for (const [identity, geography, characteristics, intermediary] of goldenCases) {
      const confidence = calculateEmployerMatchConfidence(
        assessment(identity, geography, characteristics, intermediary),
      );
      expect(Number.isFinite(confidence)).toBe(true);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it("cannot stack geography because it consumes only its aggregated label", () => {
    const input = assessment(
      "UNKNOWN",
      "MEDIUM_POSITIVE",
      "UNKNOWN",
      "WEAK_POSITIVE",
    );
    const withRepeatedSignals: EmployerMatchAssessment = {
      ...input,
      geography: {
        ...input.geography,
        supportingSignals: [{ repeated: 1 } as never, { repeated: 2 } as never],
      },
    };
    expect(calculateEmployerMatchConfidence(withRepeatedSignals)).toBe(0.48);
  });

  it("cannot inspect intermediary identities or differences", () => {
    const input = assessment("UNKNOWN", "UNKNOWN", "UNKNOWN", "WEAK_POSITIVE");
    const first: EmployerMatchAssessment = {
      ...input,
      intermediary: {
        ...input.intermediary,
        supportingSignals: [{ explanation: "ACTUA" } as never],
      },
    };
    const second: EmployerMatchAssessment = {
      ...input,
      intermediary: {
        ...input.intermediary,
        supportingSignals: [{ explanation: "SUPPLAY versus ADSEARCH" } as never],
      },
    };
    expect(calculateEmployerMatchConfidence(first)).toBe(
      calculateEmployerMatchConfidence(second),
    );
  });

  it("keeps decisive identity conflict dominant over maximum positives", () => {
    expect(
      calculateEmployerMatchConfidence(
        assessment(
          "DECISIVE_NEGATIVE",
          "VERY_STRONG_POSITIVE",
          "VERY_STRONG_POSITIVE",
          "WEAK_POSITIVE",
        ),
      ),
    ).toBe(0.02);
  });

  it("places explicit identity plus strong characteristic conflict in review territory", () => {
    expect(
      calculateEmployerMatchConfidence(
        assessment(
          "VERY_STRONG_POSITIVE",
          "UNKNOWN",
          "DECISIVE_NEGATIVE",
          "WEAK_POSITIVE",
        ),
      ),
    ).toBe(0.8);
  });

  it("requires meaningful geography for an anonymous distinctive fingerprint to auto-match", () => {
    expect(
      calculateEmployerMatchConfidence(
        assessment("UNKNOWN", "MEDIUM_POSITIVE", "VERY_STRONG_POSITIVE", "UNKNOWN"),
      ),
    ).toBe(0.91);
    expect(
      calculateEmployerMatchConfidence(
        assessment("UNKNOWN", "UNKNOWN", "VERY_STRONG_POSITIVE", "UNKNOWN"),
      ),
    ).toBe(0.84);
  });

  it("keeps all-negative or unknown combinations low", () => {
    expect(
      calculateEmployerMatchConfidence(
        assessment("STRONG_NEGATIVE", "UNKNOWN", "MODERATE_NEGATIVE", "UNKNOWN"),
      ),
    ).toBeLessThan(0.65);
    expect(
      calculateEmployerMatchConfidence(
        assessment("UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"),
      ),
    ).toBeLessThan(0.65);
  });

  it("is deterministic and does not mutate its assessment", () => {
    const input = assessment(
      "UNKNOWN",
      "MEDIUM_POSITIVE",
      "STRONG_POSITIVE",
      "WEAK_POSITIVE",
    );
    const snapshot = JSON.stringify(input);
    const first = calculateEmployerMatchConfidence(input);
    const second = calculateEmployerMatchConfidence(input);

    expect(first).toBe(second);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
