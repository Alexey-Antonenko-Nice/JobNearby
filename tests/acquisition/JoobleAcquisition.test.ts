import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const id = "-5136708324665140466";
const url = `https://fr.jooble.org/desc/${id}?tracking=ignored`;
const html = `<div data-test-name="_jdpHeaderBlock"><h1>Mécanicien Automobile</h1><span>25k € a 33k €/an</span><a data-test-name="_regionLink"><span>Strasbourg</span></a></div><div data-test-name="_jobDescriptionBlock"><p>MécanoJob, la plateforme n°1 spécialisée dans le recrutement des Métiers de la mobilité, Recherche pour son client un(e) Mécanicien(ne) automobile.</p><p>CDI - Temps plein</p></div>`;

describe("Jooble selected vacancy acquisition", () => {
  it("extracts signed /desc identity and selected core facts", async () => {
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: url, pageTitle: "Jooble", visibleText: "Mécanicien Automobile", capturedAt: "2026-09-06T12:00:00Z", html }, "jooble");
    expect(acquisition.externalId).toBe(id);
    const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "jooble-observation");
    const evidence = await createVacancyEvidenceExtractor().extract(fromSelectedVacancyContext(observation, acquisition.contexts![0]!));
    expect(evidence.vacancyTitles).toEqual([expect.objectContaining({ value: "Mécanicien Automobile" })]);
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "Strasbourg" })]);
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "MécanoJob", role: "RECRUITER" })]);
    expect(evidence.engagements.map(({ normalizedTerms }) => normalizedTerms)).toEqual([["INDEFINITE", "FULL_TIME"]]);
    expect(evidence.compensations).toEqual([expect.objectContaining({ minimum: 25000, maximum: 33000, period: "YEAR" })]);
  });

  it("fails closed for non-desc routes and keeps query identity stable", () => {
    const adapter = new BrowserCaptureAcquisitionAdapter();
    const base = { pageTitle: "Jooble", visibleText: "page", capturedAt: "2026-09-06T12:00:00Z", html };
    expect(adapter.toAcquisitionPackage({ ...base, pageUrl: url }, "one").externalId).toBe(id);
    expect(adapter.toAcquisitionPackage({ ...base, pageUrl: `https://fr.jooble.org/desc/${id}?other=1#x` }, "two").externalId).toBe(id);
    expect(adapter.toAcquisitionPackage({ ...base, pageUrl: "https://fr.jooble.org/emploi/strasbourg" }, "three").externalId).toBeUndefined();
  });
});
