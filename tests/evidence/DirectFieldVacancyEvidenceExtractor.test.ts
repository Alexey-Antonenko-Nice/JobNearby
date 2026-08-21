import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { DirectFieldVacancyEvidenceExtractor } from "../../src/application/evidence/DirectFieldVacancyEvidenceExtractor.js";

function makeObservation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    id: "observation-1",
    source: {
      sourceType: "JOB_BOARD",
      sourceName: "Indeed",
      externalId: "vacancy-42",
    },
    observedAt: new Date("2026-08-21T00:00:00.000Z"),
    displayedCompanyName: "Displayed Company",
    locationText: "Molsheim",
    description: "A named employer and recruiter appear here.",
    title: "Maintenance technician",
    contactText: "Contact Jane Recruiter",
    rawContent: "Unparsed source content",
    metadata: { hiddenEmployer: "Must not be extracted" },
    ...overrides,
  };
}

describe("DirectFieldVacancyEvidenceExtractor", () => {
  const extractor = new DirectFieldVacancyEvidenceExtractor();

  it("extracts all supported direct fields", async () => {
    const result = await extractor.extract(makeObservation());

    expect(result.organizations).toEqual([
      {
        value: "Displayed Company",
        role: "UNKNOWN",
        provenance: {
          sourceObservationId: "observation-1",
          extractionMethod: "DIRECT_FIELD",
          confidence: 1,
        },
      },
    ]);
    expect(result.locations).toEqual([
      {
        value: "Molsheim",
        role: "DISPLAYED_LOCATION",
        provenance: {
          sourceObservationId: "observation-1",
          extractionMethod: "DIRECT_FIELD",
          confidence: 1,
        },
      },
    ]);
    expect(result.externalIdentifiers).toEqual([
      {
        value: "vacancy-42",
        provider: "Indeed",
        identifierType: "SOURCE_EXTERNAL_ID",
        provenance: {
          sourceObservationId: "observation-1",
          extractionMethod: "DIRECT_FIELD",
          confidence: 1,
        },
      },
    ]);
  });

  it("omits organization evidence when displayedCompanyName is absent", async () => {
    const observation = makeObservation();
    const { displayedCompanyName: _omitted, ...withoutCompany } = observation;
    const result = await extractor.extract(withoutCompany);

    expect(result.organizations).toEqual([]);
    expect(result.locations).toHaveLength(1);
    expect(result.externalIdentifiers).toHaveLength(1);
  });

  it("omits location evidence when locationText is absent", async () => {
    const observation = makeObservation();
    const { locationText: _omitted, ...withoutLocation } = observation;
    const result = await extractor.extract(withoutLocation);

    expect(result.locations).toEqual([]);
    expect(result.organizations).toHaveLength(1);
    expect(result.externalIdentifiers).toHaveLength(1);
  });

  it("omits identifier evidence when source.externalId is absent", async () => {
    const observation = makeObservation({
      source: { sourceType: "JOB_BOARD", sourceName: "Indeed" },
    });
    const result = await extractor.extract(observation);

    expect(result.externalIdentifiers).toEqual([]);
    expect(result.organizations).toHaveLength(1);
    expect(result.locations).toHaveLength(1);
  });

  it("does not turn the provider name or unparsed fields into evidence", async () => {
    const observation = makeObservation();
    const { displayedCompanyName: _omitted, ...withoutCompany } = observation;
    const result = await extractor.extract(withoutCompany);

    expect(result.organizations).toEqual([]);
    expect(result.people).toEqual([]);
    expect(result.employerCharacteristics).toEqual([]);
    expect(result.externalIdentifiers[0]?.provider).toBe("Indeed");
  });

  it("ties the aggregate and every item to the same observation", async () => {
    const result = await extractor.extract(
      makeObservation({ id: "observation-specific" }),
    );
    const allEvidence = [
      ...result.organizations,
      ...result.locations,
      ...result.externalIdentifiers,
    ];

    expect(result.sourceObservationId).toBe("observation-specific");
    expect(
      allEvidence.every(
        ({ provenance }) =>
          provenance.sourceObservationId === "observation-specific" &&
          provenance.extractionMethod === "DIRECT_FIELD" &&
          provenance.confidence === 1,
      ),
    ).toBe(true);
  });
});
