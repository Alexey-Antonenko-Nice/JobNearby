import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";

const url = "https://www.cadremploi.fr/emploi/detail_offre?offreId=156548438119930190&utm_source=test";
const html = `<main><header><span>Bonjour Alexey</span></header><article itemscope itemtype="https://schema.org/JobPosting"><h1 itemprop="title">Coordinateur VIP IT (H/F)</h1><div itemprop="jobLocation" itemscope><meta itemprop="addressLocality" content="Meudon"><meta itemprop="addressRegion" content="Ile-de-France"><meta itemprop="addressCountry" content="France"></div><div itemprop="hiringOrganization" itemscope><meta itemprop="name" content="Free-Work"></div><p>CDI</p><p>Postuler sur le site du recruteur</p></article></main>`;

describe("Cadremploi acquisition", () => {
  it("extracts offreId and selected recruiter semantics without account UI", async () => {
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: url, pageTitle: "Cadremploi", visibleText: "Coordinateur VIP IT (H/F)", capturedAt: "2026-09-06T12:00:00Z", html }, "cadremploi");
    expect(acquisition.externalId).toBe("156548438119930190");
    expect(acquisition.contexts).toHaveLength(1);
    const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "cadremploi-observation");
    const evidence = await createVacancyEvidenceExtractor().extract(fromSelectedVacancyContext(observation, acquisition.contexts![0]!));
    expect(evidence.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "Free-Work", role: "RECRUITER" })]));
    expect(evidence.organizations).not.toContainEqual(expect.objectContaining({ value: "Bonjour Alexey" }));
  });

  it("leaves a direct Linman displayed company without recruiter contradiction", async () => {
    const directUrl = url.replace("156548438119930190", "156542023224981589");
    const directHtml = html.replace("Coordinateur VIP IT (H/F)", "Responsable de vergers F/H").replace("Free-Work", "Linman").replace("Postuler sur le site du recruteur", "Postuler");
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: directUrl, pageTitle: "Cadremploi", visibleText: "Responsable de vergers F/H", capturedAt: "2026-09-06T12:00:00Z", html: directHtml }, "linman");
    const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "linman-observation");
    const evidence = await createVacancyEvidenceExtractor().extract(fromSelectedVacancyContext(observation, acquisition.contexts![0]!));
    expect(acquisition.externalId).toBe("156542023224981589");
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Linman", role: "UNKNOWN" })]);
  });
});
