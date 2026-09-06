import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const url = "https://www.lhh.com/fr-fr/offres-emploi/detail/2089206701?utm_source=test";
const html = `<main><h1>Responsable maintenance production (h/f)</h1><p>STRASBOURG, Bas-Rhin</p><p>Temps plein CDI</p><p>€50,000–€65,000 / year</p><p>LHH Recruitment Solutions, cabinet de conseil en recrutement, intérim spécialisé, recherche pour son client.</p></main>`;

describe("LHH acquisition", () => {
  it("extracts detail identity and recruiter semantics", async () => {
    const a = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: url, pageTitle: "LHH", visibleText: "Responsable maintenance production (h/f)", capturedAt: "2026-09-06T12:00:00Z", html }, "lhh");
    expect(a.externalId).toBe("2089206701"); expect(a.contexts).toHaveLength(1);
    const o = new DeterministicAcquisitionCaptureMapper().toSourceObservation(a, "lhh-observation");
    const e = await createVacancyEvidenceExtractor().extract(fromSelectedVacancyContext(o, a.contexts![0]!));
    expect(e.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ role: "RECRUITER" }), expect.objectContaining({ role: "STAFFING_AGENCY" })]));
    expect(e.compensations[0]).toMatchObject({ minimum: 50000, maximum: 65000, currency: "EUR", period: "YEAR" });
  });

  it("rejects unrelated LHH routes", () => {
    expect(new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: "https://www.lhh.com/fr-fr", pageTitle: "LHH", visibleText: "page", capturedAt: "2026-09-06T12:00:00Z" }, "other").externalId).toBeUndefined();
  });
});
