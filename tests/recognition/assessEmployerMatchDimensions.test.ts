import { describe, expect, it } from "vitest";

import type { EmployerCharacteristicEvidence } from "../../src/domain/evidence/EmployerCharacteristicEvidence.js";
import type { LocationEvidence } from "../../src/domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../src/domain/evidence/OrganizationEvidence.js";
import type { EmployerEvidenceComparison } from "../../src/domain/recognition/EmployerEvidenceComparison.js";
import { assessEmployerMatchDimensions } from "../../src/domain/recognition/assessEmployerMatchDimensions.js";
import { compareEmployerEvidence } from "../../src/domain/recognition/compareEmployerEvidence.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";

const provenance = {
  sourceObservationId: "observation",
  extractionMethod: "TEXT_EXTRACTION" as const,
  confidence: 0.98,
};

function organization(value: string, role: OrganizationEvidence["role"]): OrganizationEvidence {
  return { value, role, provenance };
}

function location(value: string, role: LocationEvidence["role"]): LocationEvidence {
  return { value, role, provenance };
}

function characteristic(
  value: string,
  category: EmployerCharacteristicEvidence["category"],
  specificity: EmployerCharacteristicEvidence["specificity"],
): EmployerCharacteristicEvidence {
  return { value, category, specificity, provenance };
}

function compare(
  left: {
    organizations?: readonly OrganizationEvidence[];
    locations?: readonly LocationEvidence[];
    characteristics?: readonly EmployerCharacteristicEvidence[];
  },
  right: {
    organizations?: readonly OrganizationEvidence[];
    locations?: readonly LocationEvidence[];
    characteristics?: readonly EmployerCharacteristicEvidence[];
  },
) {
  const aggregate = (side: "left" | "right", input: typeof left) => {
    const sourceObservationId = `${side}-observation`;
    const reorigin = <T extends { readonly provenance: object }>(item: T) => ({
      ...item,
      provenance: { ...item.provenance, sourceObservationId },
    });
    return createExtractedVacancyEvidence({
      sourceObservationId,
      ...(input.organizations !== undefined
        ? { organizations: input.organizations.map(reorigin) }
        : {}),
      ...(input.locations !== undefined
        ? { locations: input.locations.map(reorigin) }
        : {}),
      ...(input.characteristics !== undefined
        ? { employerCharacteristics: input.characteristics.map(reorigin) }
        : {}),
    });
  };
  return compareEmployerEvidence(aggregate("left", left), aggregate("right", right));
}

describe("assessEmployerMatchDimensions", () => {
  it("assesses the same explicit employer as very strongly positive identity", () => {
    const assessment = assessEmployerMatchDimensions(
      compare(
        { organizations: [organization("LOXAM", "EMPLOYER")] },
        { organizations: [organization("loxam", "EMPLOYER")] },
      ),
    );
    expect(assessment.identity.assessment).toBe("VERY_STRONG_POSITIVE");
  });

  it("keeps decisive identity conflict separate from positive geography", () => {
    const assessment = assessEmployerMatchDimensions(
      compare(
        {
          organizations: [organization("SOLINA FRANCE", "EMPLOYER")],
          locations: [location("Weyersheim", "WORKPLACE")],
        },
        {
          organizations: [organization("ALSTOM TRANSPORT SA", "EMPLOYER")],
          locations: [location("Weyersheim", "WORKPLACE")],
        },
      ),
    );
    expect(assessment.identity.assessment).toBe("DECISIVE_NEGATIVE");
    expect(assessment.geography.assessment).toBe("MEDIUM_POSITIVE");
  });

  it("does not stack correlated location matches", () => {
    const locations = [
      location("Strasbourg", "DISPLAYED_LOCATION"),
      location("Strasbourg", "WORKPLACE"),
    ];
    const assessment = assessEmployerMatchDimensions(
      compare({ locations }, { locations }),
    );
    expect(assessment.geography.assessment).toBe("MEDIUM_POSITIVE");
    expect(assessment.geography.supportingSignals).toHaveLength(2);
  });

  it("caps duplicated intermediary context at weak positive", () => {
    const original = compare(
      { organizations: [organization("ACTUA", "RECRUITMENT_AGENCY")] },
      { organizations: [organization("ACTUA", "RECRUITMENT_AGENCY")] },
    );
    const signal = original.positiveSignals[0]!;
    const comparison: EmployerEvidenceComparison = {
      positiveSignals: [signal, { ...signal }],
      contradictions: [],
    };
    const assessment = assessEmployerMatchDimensions(comparison);
    expect(assessment.intermediary.assessment).toBe("WEAK_POSITIVE");
    expect(assessment.identity.assessment).toBe("UNKNOWN");
  });

  it("assesses one very strong characteristic as very strongly positive", () => {
    const fact = characteristic(
      "ROBOPAC distributor",
      "DISTINCTIVE_FACT",
      "VERY_HIGH",
    );
    const assessment = assessEmployerMatchDimensions(
      compare({ characteristics: [fact] }, { characteristics: [fact] }),
    );
    expect(assessment.characteristics.assessment).toBe("VERY_STRONG_POSITIVE");
  });

  it("lets a strong industry contradiction dominate a medium positive and retains both", () => {
    const shared = characteristic("shared market", "MARKET", "MEDIUM");
    const comparison = compare(
      {
        characteristics: [
          shared,
          characteristic("food manufacturing", "INDUSTRY", "MEDIUM"),
        ],
      },
      {
        characteristics: [
          shared,
          characteristic("concrete manufacturing", "INDUSTRY", "MEDIUM"),
        ],
      },
    );
    const assessment = assessEmployerMatchDimensions(comparison);
    expect(assessment.characteristics.assessment).toBe("STRONG_NEGATIVE");
    expect(assessment.characteristics.supportingSignals).toHaveLength(1);
    expect(assessment.characteristics.contradictions).toHaveLength(1);
  });

  it("assesses missing characteristics as unknown", () => {
    const assessment = assessEmployerMatchDimensions(compare({}, {}));
    expect(assessment.characteristics.assessment).toBe("UNKNOWN");
  });

  it("does not inflate duplicate characteristic signals", () => {
    const fact = characteristic("17 sites", "ORGANIZATION", "HIGH");
    const original = compare(
      { characteristics: [fact] },
      { characteristics: [fact] },
    );
    const signal = original.positiveSignals[0]!;
    const assessment = assessEmployerMatchDimensions({
      positiveSignals: [signal, { ...signal }, { ...signal }],
      contradictions: [],
    });
    expect(assessment.characteristics.assessment).toBe("STRONG_POSITIVE");
    expect(assessment.characteristics.supportingSignals).toHaveLength(3);
  });

  it("does not let an exact duplicate left/right evidence pair reinforce the dimension", () => {
    const fact = characteristic("shared process", "PROCESS", "HIGH");
    const original = compare(
      { characteristics: [fact] },
      { characteristics: [fact] },
    );
    const exactPair = original.positiveSignals[0]!;

    const assessment = assessEmployerMatchDimensions({
      positiveSignals: [exactPair, exactPair],
      contradictions: [],
    });

    expect(assessment.characteristics.assessment).toBe("STRONG_POSITIVE");
  });

  it("allows distinct strong characteristics to reinforce qualitatively", () => {
    const facts = [
      characteristic("17 sites", "ORGANIZATION", "HIGH"),
      characteristic("1,150 employees", "COMPANY_SIZE", "HIGH"),
    ];
    const assessment = assessEmployerMatchDimensions(
      compare({ characteristics: facts }, { characteristics: facts }),
    );
    expect(assessment.characteristics.assessment).toBe("VERY_STRONG_POSITIVE");
  });

  it("allows different normalized values in the same category to reinforce", () => {
    const facts = [
      characteristic("cutting process", "PROCESS", "HIGH"),
      characteristic("assembly process", "PROCESS", "HIGH"),
    ];
    const assessment = assessEmployerMatchDimensions(
      compare({ characteristics: facts }, { characteristics: facts }),
    );

    expect(assessment.characteristics.assessment).toBe("VERY_STRONG_POSITIVE");
  });

  it("does not mutate the comparison or its evidence", () => {
    const fact = characteristic("ROBOPAC distributor", "DISTINCTIVE_FACT", "VERY_HIGH");
    const comparison = compare(
      { characteristics: [fact] },
      { characteristics: [fact] },
    );
    const snapshot = JSON.stringify(comparison);
    const signal = comparison.positiveSignals[0]!;

    const assessment = assessEmployerMatchDimensions(comparison);

    expect(JSON.stringify(comparison)).toBe(snapshot);
    expect(assessment.characteristics.supportingSignals[0]).toBe(signal);
  });
});
