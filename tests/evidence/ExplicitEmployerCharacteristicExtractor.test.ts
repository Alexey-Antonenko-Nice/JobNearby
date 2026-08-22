import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { ExplicitEmployerCharacteristicExtractor } from "../../src/application/evidence/ExplicitEmployerCharacteristicExtractor.js";

function observation(description: string): SourceObservation {
  return {
    id: "observation-1",
    source: { sourceType: "JOB_BOARD", sourceName: "Synthetic source" },
    observedAt: new Date("2026-08-22T00:00:00.000Z"),
    description,
    metadata: {},
  };
}

describe("ExplicitEmployerCharacteristicExtractor", () => {
  const extractor = new ExplicitEmployerCharacteristicExtractor();

  it("extracts packaging and ROBOPAC facts for an anonymous employer", async () => {
    const result = await extractor.extract(
      observation(
        "The company supplies end-of-line packaging equipment. It is a ROBOPAC distributor.",
      ),
    );

    expect(result.employerCharacteristics).toEqual([
      expect.objectContaining({
        value: "end-of-line packaging equipment",
        category: "PRODUCT",
        specificity: "HIGH",
      }),
      expect.objectContaining({
        value: "ROBOPAC distributor",
        category: "DISTINCTIVE_FACT",
        specificity: "VERY_HIGH",
      }),
    ]);
  });

  it("extracts explicit organizational history and form", async () => {
    const result = await extractor.extract(
      observation("An independent Alsatian SME, founded in 1992."),
    );

    expect(result.employerCharacteristics).toEqual([
      expect.objectContaining({
        category: "ORGANIZATION",
        specificity: "HIGH",
      }),
      expect.objectContaining({
        value: "founded in 1992",
        category: "DISTINCTIVE_FACT",
        specificity: "HIGH",
      }),
    ]);
  });

  it("extracts explicit site and employee scale", async () => {
    const result = await extractor.extract(
      observation("The group operates 17 sites and employs 1,150 employees."),
    );

    expect(result.employerCharacteristics).toEqual([
      expect.objectContaining({
        value: "17 sites",
        category: "ORGANIZATION",
        specificity: "HIGH",
      }),
      expect.objectContaining({
        value: "1,150 employees",
        category: "COMPANY_SIZE",
        specificity: "HIGH",
      }),
    ]);
  });

  it("extracts concrete manufacturing as a medium-specificity industry", async () => {
    const result = await extractor.extract(
      observation("Our client specializes in concrete manufacturing."),
    );
    expect(result.employerCharacteristics).toEqual([
      expect.objectContaining({
        value: "concrete manufacturing",
        category: "INDUSTRY",
        specificity: "MEDIUM",
      }),
    ]);
  });

  it("extracts railway rolling-stock manufacturing as a high-specificity industry", async () => {
    const result = await extractor.extract(
      observation("The employer focuses on railway rolling-stock manufacturing."),
    );
    expect(result.employerCharacteristics).toEqual([
      expect.objectContaining({
        value: "railway rolling-stock manufacturing",
        category: "INDUSTRY",
        specificity: "HIGH",
      }),
    ]);
  });

  it("does not turn HEUFT candidate experience into employer industry", async () => {
    const result = await extractor.extract(
      observation("Experience in agro-food preferred for this position."),
    );
    expect(result.employerCharacteristics).toEqual([]);
  });

  it.each([
    "English required.",
    "Bac +2 required.",
    "Reading technical drawings is required.",
    "You are autonomous.",
    "4 years' experience required.",
    "Experience in concrete manufacturing preferred.",
    "Railway rolling-stock manufacturing experience required.",
  ])("rejects candidate requirement: %s", async (description) => {
    const result = await extractor.extract(observation(description));
    expect(result.employerCharacteristics).toEqual([]);
  });

  it.each([
    "A dynamic company.",
    "A major player in its market.",
    "An innovative company.",
    "The company is recognized internationally.",
  ])("rejects generic marketing language: %s", async (description) => {
    const result = await extractor.extract(observation(description));
    expect(result.employerCharacteristics).toEqual([]);
  });

  it("preserves specificity independently from extraction confidence", async () => {
    const result = await extractor.extract(
      observation("The business is a ROBOPAC distributor."),
    );
    expect(result.employerCharacteristics[0]).toMatchObject({
      specificity: "VERY_HIGH",
      provenance: {
        sourceObservationId: "observation-1",
        extractionMethod: "TEXT_EXTRACTION",
        confidence: 0.98,
      },
    });
  });

  it("does not inspect title or contact text for employer characteristics", async () => {
    const input = observation("No explicit employer facts here.");
    const result = await extractor.extract({
      ...input,
      title: "ROBOPAC distributor",
      contactText: "The company has 17 sites.",
    });
    expect(result.employerCharacteristics).toEqual([]);
  });
});
