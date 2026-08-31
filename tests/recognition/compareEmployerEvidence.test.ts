import { describe, expect, it } from "vitest";

import type { CreateExtractedVacancyEvidenceInput } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { compareEmployerEvidence } from "../../src/domain/recognition/compareEmployerEvidence.js";

function evidence(
  side: "left" | "right",
  input: Omit<CreateExtractedVacancyEvidenceInput, "sourceObservationId">,
) {
  const sourceObservationId = `${side}-observation`;
  const withProvenance = <T extends object>(item: T) => ({
    ...item,
    provenance: {
      sourceObservationId,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: 0.98,
    },
  });
  return createExtractedVacancyEvidence({
    sourceObservationId,
    ...(input.organizations !== undefined
      ? { organizations: input.organizations.map(withProvenance) }
      : {}),
    ...(input.locations !== undefined
      ? { locations: input.locations.map(withProvenance) }
      : {}),
    ...(input.employerCharacteristics !== undefined
      ? {
          employerCharacteristics:
            input.employerCharacteristics.map(withProvenance),
        }
      : {}),
    ...(input.externalIdentifiers !== undefined
      ? { externalIdentifiers: input.externalIdentifiers.map(withProvenance) }
      : {}),
  });
}

describe("compareEmployerEvidence", () => {
  it("returns a very strong signal for the same explicit employer", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        organizations: [{ value: " LOXAM ", role: "EMPLOYER" } as never],
      }),
      evidence("right", {
        organizations: [{ value: "loxam", role: "EMPLOYER" } as never],
      }),
    );

    expect(comparison.positiveSignals).toContainEqual(
      expect.objectContaining({
        kind: "EMPLOYER_IDENTITY",
        strength: "VERY_STRONG",
        explanation: expect.stringContaining("LOXAM"),
        leftEvidence: expect.objectContaining({ value: "LOXAM" }),
        rightEvidence: expect.objectContaining({ value: "loxam" }),
      }),
    );
    expect(comparison.contradictions).toEqual([]);
  });

  it("returns a decisive contradiction for different explicit employers", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        organizations: [{ value: "SOLINA FRANCE", role: "EMPLOYER" } as never],
      }),
      evidence("right", {
        organizations: [{ value: "ALSTOM TRANSPORT SA", role: "EMPLOYER" } as never],
      }),
    );

    expect(comparison.contradictions).toContainEqual(
      expect.objectContaining({
        kind: "EMPLOYER_IDENTITY",
        strength: "DECISIVE",
        leftEvidence: expect.objectContaining({ value: "SOLINA FRANCE" }),
        rightEvidence: expect.objectContaining({ value: "ALSTOM TRANSPORT SA" }),
      }),
    );
  });

  it("returns a strong identity signal for the same unknown-role organization", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", { organizations: [{ value: " LOXAM ", role: "UNKNOWN" } as never] }),
      evidence("right", { organizations: [{ value: "loxam", role: "UNKNOWN" } as never] }),
    );

    expect(comparison.positiveSignals).toEqual([
      expect.objectContaining({
        kind: "EMPLOYER_IDENTITY",
        strength: "STRONG",
        leftEvidence: expect.objectContaining({ value: "LOXAM", role: "UNKNOWN" }),
        rightEvidence: expect.objectContaining({ value: "loxam", role: "UNKNOWN" }),
      }),
    ]);
    expect(comparison.contradictions).toEqual([]);
  });

  it("returns a strong identity signal across matching employer and unknown roles", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", { organizations: [{ value: "ACME", role: "EMPLOYER" } as never] }),
      evidence("right", { organizations: [{ value: "acme", role: "UNKNOWN" } as never] }),
    );

    expect(comparison.positiveSignals).toEqual([
      expect.objectContaining({ kind: "EMPLOYER_IDENTITY", strength: "STRONG" }),
    ]);
  });

  it("keeps different unknown-role organizations neutral", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", { organizations: [{ value: "Agency A", role: "UNKNOWN" } as never] }),
      evidence("right", { organizations: [{ value: "Agency B", role: "UNKNOWN" } as never] }),
    );

    expect(comparison).toEqual({ positiveSignals: [], contradictions: [] });
  });

  it.each(["RECRUITMENT_AGENCY", "STAFFING_AGENCY"] as const)(
    "suppresses unknown identity inference when %s explicitly classifies the same name",
    (intermediaryRole) => {
      const organizations = [
        { value: "ACTUA", role: "UNKNOWN" },
        { value: "ACTUA", role: intermediaryRole },
      ] as never;
      const comparison = compareEmployerEvidence(
        evidence("left", { organizations }),
        evidence("right", { organizations }),
      );

      expect(comparison.positiveSignals).toEqual([
        expect.objectContaining({ kind: "INTERMEDIARY_CONTEXT", strength: "WEAK" }),
      ]);
      expect(comparison.positiveSignals).not.toContainEqual(
        expect.objectContaining({ kind: "EMPLOYER_IDENTITY" }),
      );
    },
  );

  it.each(["RECRUITER", "CONSULTANCY"] as const)(
    "suppresses unknown employer identity when the same name has explicit %s context",
    (contextRole) => {
      const organizations = [
        { value: "Akkodis", role: "UNKNOWN" },
        { value: "Akkodis", role: contextRole },
      ] as never;
      const comparison = compareEmployerEvidence(
        evidence("left", { organizations }),
        evidence("right", { organizations }),
      );

      expect(comparison.positiveSignals).not.toContainEqual(
        expect.objectContaining({ kind: "EMPLOYER_IDENTITY" }),
      );
      expect(comparison.contradictions).toEqual([]);
    },
  );

  it("applies contextual-role suppression across conservatively normalized spellings", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", { organizations: [
        { value: "Geser Best", normalizedName: "geser best", role: "UNKNOWN" } as never,
        { value: "GESER-BEST", normalizedName: "geser best", role: "RECRUITER" } as never,
      ] }),
      evidence("right", { organizations: [
        { value: "GESER BEST", normalizedName: "geser best", role: "UNKNOWN" } as never,
      ] }),
    );

    expect(comparison.positiveSignals).not.toContainEqual(
      expect.objectContaining({ kind: "EMPLOYER_IDENTITY" }),
    );
  });

  it.each(["RECRUITER", "CONSULTANCY"] as const)(
    "does not suppress explicit employer evidence when the same name also has %s context",
    (contextRole) => {
      const comparison = compareEmployerEvidence(
        evidence("left", { organizations: [
          { value: "Geser Best", normalizedName: "geser best", role: "EMPLOYER" } as never,
          { value: "GESER-BEST", normalizedName: "geser best", role: contextRole } as never,
        ] }),
        evidence("right", { organizations: [
          { value: "GESER BEST", normalizedName: "geser best", role: "UNKNOWN" } as never,
        ] }),
      );

      expect(comparison.positiveSignals).toContainEqual(
        expect.objectContaining({ kind: "EMPLOYER_IDENTITY", strength: "STRONG" }),
      );
    },
  );

  it("does not treat an explicit intermediary matching an employer name as employer identity", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", { organizations: [{ value: "ACME", role: "EMPLOYER" } as never] }),
      evidence("right", { organizations: [{ value: "ACME", role: "RECRUITMENT_AGENCY" } as never] }),
    );

    expect(comparison).toEqual({ positiveSignals: [], contradictions: [] });
  });

  it("promotes the same unknown organization even when the publication provider is the same", () => {
    const unknownOrganization = [{ value: "ACME", role: "UNKNOWN" } as never];
    const comparison = compareEmployerEvidence(
      evidence("left", {
        organizations: unknownOrganization,
        externalIdentifiers: [{ value: "left-id", provider: "Board A", identifierType: "SOURCE_EXTERNAL_ID" } as never],
      }),
      evidence("right", {
        organizations: unknownOrganization,
        externalIdentifiers: [{ value: "right-id", provider: "Board A", identifierType: "SOURCE_EXTERNAL_ID" } as never],
      }),
    );

    expect(comparison.positiveSignals).toContainEqual(
      expect.objectContaining({ kind: "EMPLOYER_IDENTITY", strength: "STRONG" }),
    );
  });

  it("promotes the same unknown organization across different publication providers", () => {
    const unknownOrganization = [{ value: "ACME", role: "UNKNOWN" } as never];
    const comparison = compareEmployerEvidence(
      evidence("left", {
        organizations: unknownOrganization,
        externalIdentifiers: [{ value: "left-id", provider: "Board A", identifierType: "SOURCE_EXTERNAL_ID" } as never],
      }),
      evidence("right", {
        organizations: unknownOrganization,
        externalIdentifiers: [{ value: "right-id", provider: "Board B", identifierType: "SOURCE_EXTERNAL_ID" } as never],
      }),
    );

    expect(comparison.positiveSignals).toContainEqual(
      expect.objectContaining({ kind: "EMPLOYER_IDENTITY", strength: "STRONG" }),
    );
  });

  it("preserves a geographic positive alongside a strong industry contradiction", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        locations: [{ value: "Weyersheim", role: "WORKPLACE" } as never],
        employerCharacteristics: [
          {
            value: "food manufacturing",
            category: "INDUSTRY",
            specificity: "MEDIUM",
          } as never,
        ],
      }),
      evidence("right", {
        locations: [{ value: "Weyersheim", role: "WORKPLACE" } as never],
        employerCharacteristics: [
          {
            value: "concrete manufacturing",
            category: "INDUSTRY",
            specificity: "MEDIUM",
          } as never,
        ],
      }),
    );

    expect(comparison.positiveSignals).toContainEqual(
      expect.objectContaining({ kind: "LOCATION", strength: "MEDIUM" }),
    );
    expect(comparison.contradictions).toContainEqual(
      expect.objectContaining({ kind: "CHARACTERISTIC", strength: "STRONG" }),
    );
  });

  it("treats the same recruitment agency as weak context, not employer identity", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        organizations: [{ value: "ACTUA", role: "RECRUITMENT_AGENCY" } as never],
      }),
      evidence("right", {
        organizations: [{ value: "actua", role: "RECRUITMENT_AGENCY" } as never],
      }),
    );

    expect(comparison.positiveSignals).toEqual([
      expect.objectContaining({ kind: "INTERMEDIARY_CONTEXT", strength: "WEAK" }),
    ]);
    expect(comparison.contradictions).toEqual([]);
  });

  it("does not contradict different recruitment agencies", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        organizations: [{ value: "SUPPLAY", role: "RECRUITMENT_AGENCY" } as never],
      }),
      evidence("right", {
        organizations: [{ value: "ADSEARCH", role: "RECRUITMENT_AGENCY" } as never],
      }),
    );

    expect(comparison).toEqual({ positiveSignals: [], contradictions: [] });
  });

  it("maps a matching very-high-specificity characteristic to a very strong signal", () => {
    const characteristic = {
      value: "ROBOPAC distributor",
      category: "DISTINCTIVE_FACT" as const,
      specificity: "VERY_HIGH" as const,
    };
    const comparison = compareEmployerEvidence(
      evidence("left", { employerCharacteristics: [characteristic as never] }),
      evidence("right", { employerCharacteristics: [characteristic as never] }),
    );

    expect(comparison.positiveSignals).toContainEqual(
      expect.objectContaining({ kind: "CHARACTERISTIC", strength: "VERY_STRONG" }),
    );
  });

  it("treats missing evidence as neutral", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        employerCharacteristics: [
          {
            value: "1,150 employees",
            category: "COMPANY_SIZE",
            specificity: "HIGH",
          } as never,
        ],
      }),
      evidence("right", {}),
    );

    expect(comparison).toEqual({ positiveSignals: [], contradictions: [] });
  });

  it("does not contradict different complementary characteristics", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        employerCharacteristics: [
          { value: "17 sites", category: "ORGANIZATION", specificity: "HIGH" } as never,
        ],
      }),
      evidence("right", {
        employerCharacteristics: [
          {
            value: "1,150 employees",
            category: "COMPANY_SIZE",
            specificity: "HIGH",
          } as never,
        ],
      }),
    );

    expect(comparison).toEqual({ positiveSignals: [], contradictions: [] });
  });

  it.each([
    ["VERY_LOW", "WEAK"],
    ["LOW", "WEAK"],
    ["MEDIUM", "MEDIUM"],
    ["HIGH", "STRONG"],
    ["VERY_HIGH", "VERY_STRONG"],
  ] as const)("maps %s specificity to %s signal strength", (specificity, strength) => {
    const characteristic = {
      value: "shared fact",
      category: "OTHER" as const,
      specificity,
    };
    const comparison = compareEmployerEvidence(
      evidence("left", { employerCharacteristics: [characteristic as never] }),
      evidence("right", { employerCharacteristics: [characteristic as never] }),
    );
    expect(comparison.positiveSignals[0]?.strength).toBe(strength);
  });

  it("treats the same displayed location alone as weak evidence", () => {
    const comparison = compareEmployerEvidence(
      evidence("left", {
        locations: [{ value: "Strasbourg", role: "DISPLAYED_LOCATION" } as never],
      }),
      evidence("right", {
        locations: [{ value: "strasbourg", role: "DISPLAYED_LOCATION" } as never],
      }),
    );
    expect(comparison.positiveSignals[0]).toMatchObject({
      kind: "LOCATION",
      strength: "WEAK",
    });
  });
});
