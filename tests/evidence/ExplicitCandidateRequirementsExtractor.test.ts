import { describe, expect, it } from "vitest";

import { ExplicitCandidateRequirementsExtractor } from "../../src/application/evidence/ExplicitCandidateRequirementsExtractor.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const extractor = new ExplicitCandidateRequirementsExtractor();

function observation(text: string): SourceObservation {
  return {
    id: "requirements-observation",
    source: { sourceType: "JOB_BOARD", sourceName: "Example" },
    observedAt: new Date("2026-09-01T00:00:00Z"),
    description: text,
    metadata: {},
  };
}

describe("ExplicitCandidateRequirementsExtractor language requirements", () => {
  it("extracts required language without inventing a level", async () => {
    const result = await extractor.extract(observation("Anglais obligatoire."));
    expect(result.languageRequirements).toEqual([expect.objectContaining({
      rawText: "Anglais obligatoire", language: "English", requirement: "REQUIRED",
    })]);
    expect(result.languageRequirements[0]).not.toHaveProperty("level");
  });

  it("extracts CEFR, preferred, plus, and multiple languages", async () => {
    const result = await extractor.extract(observation(
      "Allemand B2. German preferred. French is a plus. niveau C1 en anglais. Fluent English.",
    ));
    expect(result.languageRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: "German", level: "B2", requirement: "UNKNOWN" }),
      expect.objectContaining({ language: "German", requirement: "PREFERRED" }),
      expect.objectContaining({ language: "French", requirement: "PLUS" }),
      expect.objectContaining({ language: "English", level: "C1" }),
      expect.objectContaining({ rawText: "Fluent English", language: "English", requirement: "UNKNOWN" }),
    ]));
  });

  it.each([
    "Our English company description is available here.",
    "Cette offre rédigée en français concerne un poste à Paris.",
    "English version available.",
    "France, Germany and the United Kingdom.",
  ])("does not infer a requirement from ordinary language prose: %s", async (text) => {
    expect((await extractor.extract(observation(text))).languageRequirements).toEqual([]);
  });
});

describe("ExplicitCandidateRequirementsExtractor experience requirements", () => {
  it.each([
    ["3 ans d'expérience", 3, undefined],
    ["minimum 3 ans d'expérience", 3, undefined],
    ["au moins 5 années d'expérience", 5, undefined],
    ["expérience de 2 à 4 années d'expérience", 2, 4],
    ["5 ans minimum", 5, undefined],
    ["vous justifiez de 3 ans d'expérience", 3, undefined],
    ["minimum 5 years' experience", 5, undefined],
    ["at least 2 years of experience", 2, undefined],
    ["2-4 years experience", 2, 4],
    ["5+ years of experience", 5, undefined],
  ])("extracts %s", async (text, minimumYears, maximumYears) => {
    const evidence = (await extractor.extract(observation(text))).experienceRequirements[0];
    expect(evidence).toMatchObject({ rawText: text, minimumYears, unit: "YEAR" });
    if (maximumYears === undefined) expect(evidence).not.toHaveProperty("maximumYears");
    else expect(evidence?.maximumYears).toBe(maximumYears);
  });

  it.each([
    "CDD de 6 mois", "formation de 3 mois", "entreprise créée il y a 5 ans",
    "projet de 2 ans", "garantie 3 ans", "Senior engineer",
    "Our company has over 50 years of experience in manufacturing",
  ])("rejects unrelated durations: %s", async (text) => {
    expect((await extractor.extract(observation(text))).experienceRequirements).toEqual([]);
  });
});

describe("ExplicitCandidateRequirementsExtractor travel requirements", () => {
  it.each([
    ["déplacements fréquents", "FREQUENT", undefined],
    ["déplacements réguliers", "REGULAR", undefined],
    ["déplacements ponctuels", "OCCASIONAL", undefined],
    ["déplacements internationaux", undefined, "INTERNATIONAL"],
    ["mobilité nationale", undefined, "DOMESTIC"],
    ["frequent international travel required", "FREQUENT", "INTERNATIONAL"],
    ["occasional domestic travel", "OCCASIONAL", "DOMESTIC"],
  ])("extracts %s", async (text, frequency, scope) => {
    const evidence = (await extractor.extract(observation(text))).travelRequirements[0];
    expect(evidence).toMatchObject({ rawText: text, requirement: "REQUIRED" });
    if (frequency !== undefined) expect(evidence?.frequency).toBe(frequency);
    if (scope !== undefined) expect(evidence?.scope).toBe(scope);
  });

  it("extracts explicit percentages and willingness", async () => {
    expect((await extractor.extract(observation("jusqu'à 50 % de déplacements")))
      .travelRequirements[0]).toMatchObject({ percentage: 50 });
    expect((await extractor.extract(observation("willingness to travel")))
      .travelRequirements[0]).toMatchObject({ requirement: "REQUIRED" });
  });

  it.each([
    "site client", "terrain", "field engineer", "mise en service", "international group",
    "Travel", "Déplacements",
  ])("does not infer travel from role context: %s", async (text) => {
    expect((await extractor.extract(observation(text))).travelRequirements).toEqual([]);
  });

  it("uses only bounded selected context with selected-context provenance", async () => {
    const source = { ...observation("English required. 9 years of experience. frequent travel."), rawContent: "German required" };
    const result = await extractor.extract(fromSelectedVacancyContext(source, {
      kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR",
      text: "French preferred. 3 years of experience. occasional travel.",
    }));
    expect(result.languageRequirements.map(({ language }) => language)).toEqual(["French"]);
    expect(result.experienceRequirements[0]?.minimumYears).toBe(3);
    expect(result.travelRequirements[0]?.frequency).toBe("OCCASIONAL");
    for (const evidence of [
      ...result.languageRequirements, ...result.experienceRequirements, ...result.travelRequirements,
    ]) expect(evidence.provenance).toMatchObject({
      extractionMethod: "TEXT_EXTRACTION", confidence: 0.98,
      contentOrigin: "SELECTED_VACANCY_CONTEXT",
    });
  });
});
