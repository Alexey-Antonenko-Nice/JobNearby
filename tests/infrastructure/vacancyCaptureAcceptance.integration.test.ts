import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import { captureAndProcessBrowserVacancy } from "../../src/application/acquisition/captureAndProcessBrowserVacancy.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { adeccoElementsWithClass } from "../../src/application/acquisition/AdeccoSelectedVacancyContextLocator.js";

const regressionUrl = "https://www.michaelpage.fr/job-detail/technicienne-sav-france-fh/ref/jn-102026-7118382";
const failedCapture = {
  pageUrl: regressionUrl,
  pageTitle: "Technicienne SAV France F/H | Michael Page",
  visibleText: "Technicienne SAV France F/H\nParis\nCDI\nMichael Page",
  html: `<main><h1>Technicienne SAV France F/H</h1><p>Michael Page</p></main>
    <script type="application/ld+json">{"@type":"JobPosting","title":"Other job","hiringOrganization":{"name":"Other company"}}</script>`,
  capturedAt: "2026-11-10T12:00:00Z",
};
const validUrl = "https://www.michaelpage.fr/job-detail/ing%C3%A9nieur-conception-m%C3%A9canique-hf/ref/jn-082026-7089819";
const validHtml = readFileSync("tests/fixtures/michaelPageSelectedVacancy.html", "utf8");

describe("browser vacancy acceptance", () => {
  it("persists a rejected Michael Page capture without any claim, vacancy, cluster or assignment", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const result = await runtime.captureAndProcessBrowserVacancy(failedCapture);
      expect(result.processing).toEqual({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false, rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT" });
      expect(db.prepare("SELECT source_name, external_id FROM source_observations WHERE id = ?").get(result.capture.observationId))
        .toEqual({ source_name: "michaelpage.fr", external_id: "jn-102026-7118382" });
      for (const table of ["canonical_vacancies", "canonical_vacancy_source_observations", "canonical_vacancy_observation_claims", "canonical_vacancy_exact_identity_claims", "employer_clusters", "observation_cluster_assignments"]) {
        expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
      const again = await runtime.captureAndProcessBrowserVacancy(failedCapture);
      expect(again.capture.observationId).toBe(result.capture.observationId);
      expect(db.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });
    } finally { db.close(); }
  });

  it("never invokes processing or its failure handler on an external ID without a context", async () => {
    const processVacancyObservation = vi.fn();
    const onProcessingFailure = vi.fn();
    const repository = new InMemorySourceObservationRepository();
    const result = await captureAndProcessBrowserVacancy(failedCapture, {
      ingestion: { repository, acquisitionMapper: new DeterministicAcquisitionCaptureMapper() },
      processVacancyObservation, onProcessingFailure,
    });
    expect(result.processing.status).toBe("VACANCY_NOT_DETECTED");
    expect(await repository.findById(result.capture.observationId)).not.toBeNull();
    expect(processVacancyObservation).not.toHaveBeenCalled();
    expect(onProcessingFailure).not.toHaveBeenCalled();
  });

  it("rejects a bounded selected pane without a title even when the page title looks like a job", async () => {
    const db = createDatabase(":memory:");
    try {
      const id = "4449077982";
      const result = await createCaptureProcessingRuntime(db).captureAndProcessBrowserVacancy({
        pageUrl: `https://www.linkedin.com/jobs/search-results/?currentJobId=${id}`,
        pageTitle: "Engineer H/F",
        visibleText: "Engineer H/F\nParis",
        html: `<div componentkey="job-card-component-ref-${id}">Engineer H/F</div>
          <div id="JobDetails_AboutTheJob_${id}" componentkey="JobDetails_AboutTheJob_${id}"><h2>À propos de l’offre d’emploi</h2><p>Selected description.</p></div>`,
        capturedAt: failedCapture.capturedAt,
      });
      expect(result.processing).toEqual({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false, rejectionReason: "NO_MEANINGFUL_VACANCY_EVIDENCE" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it("does not accept unrelated JobPosting metadata or conflicting selected identity", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const unrelated = await runtime.captureAndProcessBrowserVacancy({ ...failedCapture, pageUrl: "https://example.test/jobs/123" });
      expect(unrelated.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED" });
      const article = adeccoElementsWithClass(validHtml, "job-advert")[0]!;
      const conflict = await runtime.captureAndProcessBrowserVacancy({
        ...failedCapture, pageUrl: validUrl, html: validHtml.replace(article, article.replace("JN-082026-7089819", "JN-082026-9999999")),
      });
      expect(conflict.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false });
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it("does not promote legacy locators that can return an unbounded page", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      for (const [pageUrl, html] of [
        ["https://www.lhh.com/fr-fr/offres-emploi/detail/2089206701", "<h1>Responsable maintenance H/F</h1><p>recherche pour son client</p>"],
        ["https://www.cadremploi.fr/emploi/detail_offre?offreId=1234", "<h1>Technicien H/F</h1><p>Paris</p>"],
      ]) {
        const result = await runtime.captureAndProcessBrowserVacancy({ ...failedCapture, pageUrl: pageUrl!, html: html! });
        expect(result.processing.status).toBe("VACANCY_NOT_DETECTED");
      }
    } finally { db.close(); }
  });

  it("requires a matching reference and a unique title header for generic Workday", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const payload = {
        pageUrl: "https://example.wd5.myworkdayjobs.com/en-US/site/details/Engineer_JR-2026-123",
        pageTitle: "Engineer", visibleText: "Engineer", capturedAt: failedCapture.capturedAt,
      };
      const header = '<h2 data-automation-id="jobPostingHeader">Software Engineer</h2>';
      for (const html of [
        header,
        `${header}<div data-automation-id="requisitionId">JR-2026-999</div>`,
        `${header}${header}<div data-automation-id="requisitionId">JR-2026-123</div>`,
        '<h2 hidden data-automation-id="jobPostingHeader">Software Engineer</h2><div data-automation-id="requisitionId">JR-2026-123</div>',
        '<div data-automation-id="jobPostingHeader">Search jobs</div><div data-automation-id="requisitionId">JR-2026-123</div>',
      ]) {
        const result = await runtime.captureAndProcessBrowserVacancy({ ...payload, html });
        expect(result.processing.status).toBe("VACANCY_NOT_DETECTED");
      }
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it("does not accept hidden or duplicated Personio job titles", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      for (const html of [
        '<div class="job-header" hidden><h1 class="job-position-title">Software Engineer</h1></div>',
        '<div class="job-header"><h1 class="job-position-title" aria-hidden="true">Software Engineer</h1></div>',
        '<div class="job-header"><h1 class="job-position-title">Software Engineer</h1><h1 class="job-position-title">Other Engineer</h1></div>',
      ]) {
        const result = await runtime.captureAndProcessBrowserVacancy({
          ...failedCapture, pageUrl: "https://example.jobs.personio.de/job/123", html,
        });
        expect(result.processing.status).toBe("VACANCY_NOT_DETECTED");
      }
    } finally { db.close(); }
  });

  it("accepts a bounded vacancy with an unnamed employer and maintains recapture semantics", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const payload = { pageUrl: validUrl, pageTitle: "Michael Page", visibleText: "Vacancy", html: validHtml, capturedAt: failedCapture.capturedAt };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      expect(first.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, employerStatus: "UNRESOLVED_RECORD_CREATED" });
      if (first.processing.status !== "PROCESSED") throw Error("Expected an accepted vacancy.");
      expect(db.prepare("SELECT status FROM employer_clusters").all()).toEqual([{ status: "UNRESOLVED" }]);
      const second = await runtime.captureAndProcessBrowserVacancy(payload);
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: false });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, visibleText: "Updated snapshot" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM capture_occurrences WHERE source_observation_id = ?").get(first.capture.observationId)).toEqual({ count: 2 });
      const rejected = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: "<main>Vacancy unavailable</main>" });
      expect(rejected.processing.status).toBe("VACANCY_NOT_DETECTED");
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancy_source_observations WHERE source_observation_id = ?").get(rejected.capture.observationId)).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM observation_cluster_assignments WHERE source_observation_id = ?").get(rejected.capture.observationId)).toEqual({ count: 0 });
    } finally { db.close(); }
  });

  it("returns an explicit non-error rejection with no review vacancy ID through HTTP", async () => {
    const db = createDatabase(":memory:");
    const runtime = createCaptureProcessingRuntime(db);
    const server = createBrowserCaptureServer({ captureAndProcessBrowserVacancy: runtime.captureAndProcessBrowserVacancy });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/acquisition/browser`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(failedCapture),
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { success: boolean; processing: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(body.processing).toEqual({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false, rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT" });
      expect(body.processing).not.toHaveProperty("canonicalVacancyId");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    }
  });
});
