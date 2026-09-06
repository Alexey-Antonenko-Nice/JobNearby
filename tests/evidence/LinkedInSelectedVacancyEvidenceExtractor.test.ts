import { describe, expect, it } from "vitest";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

function observation(text: string): SourceObservation { return { id: "linkedin", source: { sourceType: "JOB_BOARD", sourceName: "linkedin.com", sourceUrl: "https://www.linkedin.com/jobs/view/4461178074/x", externalId: "4461178074" }, observedAt: new Date("2026-09-06T12:00:00Z"), metadata: {} }; }

describe("LinkedIn direct selected header evidence", () => {
  it("extracts Manpower header facts and staffing contradiction", async () => {
    const text = "ManpowerGroup\nTechnicien maintenance/Technicienne maintenance\nStrasbourg, Grand Est, France · il y a 2 jours\nSur site\nTemps plein\nÀ propos de l’offre d’emploi\nManpower Cabinet de Recrutement de Strasbourg recherche pour son client un technicien.";
    const o = observation(text); const context = fromSelectedVacancyContext(o, { kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "LINKEDIN", providerExternalId: "4461178074", text, html: `<section data-linkedin-selected-vacancy-context="direct-view">${text}</section>`, associationEvidence: ["fixture"] });
    const e = await createVacancyEvidenceExtractor().extract(context);
    expect(e.vacancyTitles).toEqual([expect.objectContaining({ value: "Technicien maintenance/Technicienne maintenance" })]);
    expect(e.locations).toEqual([expect.objectContaining({ value: "Strasbourg, Grand Est, France" })]);
    expect(e.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "ManpowerGroup", role: "STAFFING_AGENCY" })]));
  });

  it("keeps a direct LinkedIn company eligible without staffing wording", async () => {
    const text = "Company X\nTechnicien maintenance H/F\nStrasbourg, Grand Est, France\nÀ propos de l’offre d’emploi\nDescription";
    const o = observation(text); const context = fromSelectedVacancyContext(o, { kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "LINKEDIN", providerExternalId: "4461178074", text, html: `<section data-linkedin-selected-vacancy-context="direct-view">${text}</section>`, associationEvidence: ["fixture"] });
    const e = await createVacancyEvidenceExtractor().extract(context);
    expect(e.organizations).toEqual([expect.objectContaining({ value: "Company X", role: "UNKNOWN" })]);
  });
});
