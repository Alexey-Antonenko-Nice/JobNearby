import { describe, expect, it } from "vitest";

import { createEvidenceProvenance } from "../../src/domain/evidence/EvidenceProvenance.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { createExternalIdentifierEvidence } from "../../src/domain/evidence/ExternalIdentifierEvidence.js";
import { createOrganizationEvidence } from "../../src/domain/evidence/OrganizationEvidence.js";
import type { VacancyEvidenceExtractor } from "../../src/domain/evidence/VacancyEvidenceExtractor.js";

const direct = {
  sourceObservationId: "observation-1",
  extractionMethod: "DIRECT_FIELD" as const,
  confidence: 1,
};
const extracted = {
  sourceObservationId: "observation-1",
  extractionMethod: "TEXT_EXTRACTION" as const,
  confidence: 0.9,
};

describe("ExtractedVacancyEvidence", () => {
  it("represents direct employer evidence", () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
      organizations: [
        { value: "HEUFT France", role: "EMPLOYER", provenance: direct },
      ],
    });

    expect(result.organizations[0]).toEqual({
      value: "HEUFT France",
      role: "EMPLOYER",
      provenance: direct,
    });
  });

  it("keeps a recruitment intermediary separate from an explicit employer", () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
      organizations: [
        {
          value: "ACTUA",
          role: "RECRUITMENT_AGENCY",
          provenance: direct,
        },
        { value: "HEUFT France", role: "EMPLOYER", provenance: extracted },
      ],
    });

    expect(result.organizations.map(({ role }) => role)).toEqual([
      "RECRUITMENT_AGENCY",
      "EMPLOYER",
    ]);
  });

  it("keeps displayed and actual workplace locations distinct", () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
      locations: [
        { value: "Strasbourg", role: "DISPLAYED_LOCATION", provenance: direct },
        { value: "Brumath", role: "WORKPLACE", provenance: extracted },
      ],
    });

    expect(result.locations).toMatchObject([
      { value: "Strasbourg", role: "DISPLAYED_LOCATION" },
      { value: "Brumath", role: "WORKPLACE" },
    ]);
  });

  it("preserves named recruiters", () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
      people: [
        { value: "Camille Martin", role: "RECRUITER", provenance: extracted },
      ],
    });

    expect(result.people[0]).toMatchObject({
      value: "Camille Martin",
      role: "RECRUITER",
    });
  });

  it("preserves multiple provider-specific identifiers", () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
      externalIdentifiers: [
        {
          value: "ACT-42",
          provider: "ACTUA",
          identifierType: "VACANCY_ID",
          provenance: direct,
        },
        {
          value: "HH-900",
          provider: "HelloWork",
          identifierType: "PUBLICATION_ID",
          provenance: direct,
        },
      ],
    });

    expect(result.externalIdentifiers).toHaveLength(2);
  });

  it("represents employer characteristics without scoring weights", () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
      employerCharacteristics: [
        { value: "Paper manufacturing", category: "INDUSTRY", specificity: "HIGH", provenance: extracted },
        { value: "Biomass boiler", category: "EQUIPMENT", specificity: "VERY_HIGH", provenance: extracted },
        { value: "Approximately 160 employees", category: "COMPANY_SIZE", specificity: "HIGH", provenance: extracted },
      ],
    });

    expect(result.employerCharacteristics.map(({ category }) => category)).toEqual([
      "INDUSTRY",
      "EQUIPMENT",
      "COMPANY_SIZE",
    ]);
  });

  it.each([0, 1])("accepts extraction confidence boundary %s", (confidence) => {
    expect(
      createEvidenceProvenance({ ...direct, confidence }),
    ).toMatchObject({ confidence });
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid extraction confidence %s",
    (confidence) => {
      expect(() => createEvidenceProvenance({ ...direct, confidence })).toThrow(
        "Evidence extraction confidence must be between 0 and 1.",
      );
    },
  );

  it("preserves whether evidence was extracted from selected vacancy context", () => {
    expect(createEvidenceProvenance({
      ...extracted,
      contentOrigin: "SELECTED_VACANCY_CONTEXT",
    })).toEqual({
      ...extracted,
      contentOrigin: "SELECTED_VACANCY_CONTEXT",
    });
  });

  it("rejects empty required textual values", () => {
    expect(() =>
      createOrganizationEvidence({
        value: "  ",
        role: "EMPLOYER",
        provenance: direct,
      }),
    ).toThrow("Organization evidence value is required.");
    expect(() =>
      createExternalIdentifierEvidence({
        value: "identifier",
        provider: " ",
        identifierType: "VACANCY_ID",
        provenance: direct,
      }),
    ).toThrow("External identifier provider is required.");
  });

  it("rejects evidence attributed to another observation", () => {
    expect(() =>
      createExtractedVacancyEvidence({
        sourceObservationId: "observation-1",
        organizations: [
          {
            value: "Acme",
            role: "EMPLOYER",
            provenance: { ...direct, sourceObservationId: "observation-2" },
          },
        ],
      }),
    ).toThrow("Every evidence item must originate");
  });

  it("supports a provider-independent asynchronous extractor", async () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: "observation-1",
    });
    const extractor: VacancyEvidenceExtractor = {
      async extract(observation) {
        expect(observation.id).toBe("observation-1");
        return result;
      },
    };

    await expect(
      extractor.extract({
        id: "observation-1",
        source: { sourceType: "MANUAL", sourceName: "test" },
        observedAt: new Date("2026-08-21T00:00:00.000Z"),
        metadata: {},
      }),
    ).resolves.toBe(result);
  });
});
