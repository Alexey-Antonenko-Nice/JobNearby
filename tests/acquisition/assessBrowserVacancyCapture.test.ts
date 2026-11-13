import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractor } from "../../src/domain/evidence/VacancyEvidenceExtractor.js";

const pageUrl = "https://www.michaelpage.fr/job-detail/technicienne-sav-france-fh/ref/jn-102026-7118382";
const html = readFileSync("tests/fixtures/michaelPageTechnicienVacancy.html", "utf8");

function observation(content: string, url = pageUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({
    pageUrl: url, pageTitle: "Engineer", visibleText: "Engineer", html: content,
    capturedAt: "2026-11-10T12:00:00Z",
  }, "acquisition");
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
}

describe("browser vacancy acceptance decision", () => {
  it("returns only the observation identity needed for promotion of a bounded vacancy", async () => {
    const source = observation(html);
    const before = structuredClone(source);
    expect(await assessBrowserVacancyCapture(source, createVacancyEvidenceExtractor())).toEqual({
      captureAcceptedAsVacancy: true,
      sourceObservationId: "observation",
    });
    expect(source).toEqual(before);
  });

  it("returns diagnostic identity and skips extraction when there is no trusted boundary", async () => {
    const extract = vi.fn<VacancyEvidenceExtractor["extract"]>();
    expect(await assessBrowserVacancyCapture(observation("<main>Unavailable</main>"), { extract })).toEqual({
      captureAcceptedAsVacancy: false,
      rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT",
      sourceObservationId: "observation",
      retainedExternalId: "jn-102026-7118382",
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it("does not invent a diagnostic external ID for an unsupported route", async () => {
    expect(await assessBrowserVacancyCapture(observation("<main>Unavailable</main>", "https://example.test/jobs"), createVacancyEvidenceExtractor())).toEqual({
      captureAcceptedAsVacancy: false,
      rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT",
      sourceObservationId: "observation",
    });
  });

  it.each(["missing", "outside context"] as const)("rejects %s title evidence inside a trusted boundary", async kind => {
    const actual = createVacancyEvidenceExtractor();
    const extract: VacancyEvidenceExtractor["extract"] = async input => {
      const evidence = await actual.extract(input);
      return {
        ...evidence,
        vacancyTitles: kind === "missing" ? [] : evidence.vacancyTitles.map(title => ({ ...title, value: "Unrelated page title" })),
      };
    };
    expect(await assessBrowserVacancyCapture(observation(html), { extract })).toEqual({
      captureAcceptedAsVacancy: false,
      rejectionReason: "NO_MEANINGFUL_VACANCY_EVIDENCE",
      sourceObservationId: "observation",
      retainedExternalId: "jn-102026-7118382",
    });
  });

  it("does not offer partial recapture when the selected-context ID conflicts with the source ID", async () => {
    const url = "https://www.linkedin.com/jobs/view/engineer-4478539511/";
    const html = `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails">
      <div data-testid="lazy-column">
        <div id="JobDetails_ManageJobBanner_4478539511"></div>
        <div data-testid="job-header"><a href="/jobs/view/engineer-4478539511/"></a></div>
        <div data-testid="details-and-extras">
          <div id="JobDetails_AboutTheJob_4478539511" componentkey="JobDetails_AboutTheJob_4478539511">
            <h2>À propos de l’offre d’emploi</h2>
            <p>Cette description détaillée présente les responsabilités du poste et l’équipe.</p>
          </div>
        </div>
      </div>
    </div>`;
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({
      pageUrl: url,
      pageTitle: "LinkedIn",
      visibleText: "Page text",
      html,
      capturedAt: "2026-11-10T12:00:00Z",
    }, "linkedin-acquisition");
    const observation = new DeterministicAcquisitionCaptureMapper()
      .toSourceObservation(acquisition, "linkedin-observation");
    const conflicting = {
      ...observation,
      source: { ...observation.source, externalId: "4483996806" },
    };
    expect(await assessBrowserVacancyCapture(conflicting, createVacancyEvidenceExtractor()))
      .toMatchObject({
        captureAcceptedAsVacancy: false,
        rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT",
      });
    expect(await assessBrowserVacancyCapture(conflicting, createVacancyEvidenceExtractor()))
      .not.toHaveProperty("partialRecaptureIdentity");
  });
});
