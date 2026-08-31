import { describe, expect, it } from "vitest";

import { CoreVacancyHeaderFactsExtractor } from "../../src/application/evidence/CoreVacancyHeaderFactsExtractor.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const extractor = new CoreVacancyHeaderFactsExtractor();

function selected(text: string, id = "selected-observation") {
  const observation: SourceObservation = {
    id,
    source: { sourceType: "JOB_BOARD", sourceName: "example.test" },
    observedAt: new Date("2026-08-31T08:00:00.000Z"),
    metadata: {},
  };
  return fromSelectedVacancyContext(observation, {
    kind: "SELECTED_VACANCY",
    associationMethod: "PROVIDER_LOCATOR",
    providerExternalId: "vacancy-1",
    text,
    html: `<section>${text}</section>`,
    associationEvidence: ["fixture"],
  });
}

describe("CoreVacancyHeaderFactsExtractor", () => {
  it("extracts the explicit France Travail header facts without inventing work mode", async () => {
    const result = await extractor.extract(selected([
      "Ingénieur Industrialisation Composants Plastiques H/F",
      "67 - Strasbourg",
      "CDI",
      "Salaire brut : Annuel de 42000.0 Euros à 46000.0 Euros",
      "Description",
    ].join("\n")));

    expect(result.vacancyTitles.map(({ value }) => value)).toEqual(["Ingénieur Industrialisation Composants Plastiques H/F"]);
    expect(result.locations.map(({ value, role }) => ({ value, role }))).toEqual([{ value: "Strasbourg", role: "WORKPLACE" }]);
    expect(result.engagements[0]).toMatchObject({ rawTerms: ["CDI"], normalizedTerms: ["INDEFINITE"] });
    expect(result.compensations[0]).toMatchObject({ currency: "EUR", minimum: 42000, maximum: 46000, period: "YEAR" });
    expect(result.workModes).toEqual([]);
  });

  it("extracts the explicit LinkedIn header facts without inventing compensation", async () => {
    const result = await extractor.extract(selected([
      "Akkodis",
      "Ingénieur conception mécanique H/F",
      "Pays de la Loire, France · il y a 3 semaines · 27 personnes ont cliqué",
      "Hybride",
      "CDD",
      "À propos de l'offre d'emploi",
    ].join("\n")));

    expect(result.vacancyTitles[0]?.value).toBe("Ingénieur conception mécanique H/F");
    expect(result.locations[0]?.value).toBe("Pays de la Loire, France");
    expect(result.engagements[0]?.normalizedTerms).toEqual(["FIXED_TERM"]);
    expect(result.workModes[0]?.value).toBe("HYBRID");
    expect(result.compensations).toEqual([]);
    for (const evidence of [...result.vacancyTitles, ...result.locations, ...result.engagements, ...result.workModes]) {
      expect(evidence.provenance).toMatchObject({ sourceObservationId: "selected-observation", extractionMethod: "TEXT_EXTRACTION", confidence: 0.98, contentOrigin: "SELECTED_VACANCY_CONTEXT" });
    }
  });

  it("extracts an explicit salary range embedded in normalized bounded text", async () => {
    const result = await extractor.extract(selected(
      "Conditions proposées · CDI · Salaire brut :  Annuel de 42000.0 Euros à 46000.0 Euros · Prise de poste immédiate",
    ));

    expect(result.compensations).toEqual([
      expect.objectContaining({
        rawText: "Salaire brut : Annuel de 42000.0 Euros à 46000.0 Euros",
        currency: "EUR",
        minimum: 42000,
        maximum: 46000,
        period: "YEAR",
      }),
    ]);
  });

  it("does not extract a location before France without a conservative header boundary", async () => {
    const result = await extractor.extract(selected(
      "Technicien maintenance H/F\nNotre groupe intervient en Pays de la Loire, France auprès de nombreux clients.",
    ));

    expect(result.locations).toEqual([]);
  });

  it("rejects headings, unrelated numbers, and implicit on-site assumptions", async () => {
    const result = await extractor.extract(selected([
      "Description",
      "Profil",
      "À propos de l'offre d'emploi",
      "Une équipe de 42 personnes utilise 3 machines.",
      "CDI",
    ].join("\n")));
    expect(result.vacancyTitles).toEqual([]);
    expect(result.compensations).toEqual([]);
    expect(result.workModes).toEqual([]);
  });

  it("cannot be contaminated by neighboring full-page vacancy text outside the selected context", async () => {
    const input = selected([
      "Technicien maintenance H/F",
      "67 - Strasbourg",
      "CDI",
    ].join("\n"));
    const result = await extractor.extract({
      ...input,
      rawContent: "Développeur voisin H/F\nParis, France\nCDD\nHybride",
    });
    expect(result.vacancyTitles.map(({ value }) => value)).toEqual(["Technicien maintenance H/F"]);
    expect(result.vacancyTitles).not.toContainEqual(expect.objectContaining({ value: "Développeur voisin H/F" }));
  });
});
