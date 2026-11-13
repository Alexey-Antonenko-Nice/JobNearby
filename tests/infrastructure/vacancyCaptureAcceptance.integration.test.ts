import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import { captureAndProcessBrowserVacancy } from "../../src/application/acquisition/captureAndProcessBrowserVacancy.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
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
const linkedinId = "4478539511";
const linkedinUrl = `https://www.linkedin.com/jobs/view/concepteur-mecanique-h-f-at-segula-${linkedinId}/`;

function linkedinCapture(mode: "RICH" | "DESCRIPTION_ONLY" | "HEADER_ONLY", capturedAt: string) {
  const header = mode !== "DESCRIPTION_ONLY"
    ? `<div data-testid="job-header">
        <p>SEGULA Technologies</p>
        <a href="/jobs/view/concepteur-mecanique-h-f-at-segula-${linkedinId}/">Concepteur mécanique H/F</a>
        <p>Dunkerque, Hauts-de-France, France · il y a 2 semaines</p>
      </div>`
    : `<div data-testid="job-header"><a href="/jobs/view/concepteur-mecanique-h-f-at-segula-${linkedinId}/"></a></div>`;
  const details = mode === "HEADER_ONLY"
    ? `<div id="JobDetails_AboutTheJob_${linkedinId}" componentkey="JobDetails_AboutTheJob_${linkedinId}"></div>`
    : `<div id="JobDetails_AboutTheJob_${linkedinId}" componentkey="JobDetails_AboutTheJob_${linkedinId}">
        <h2>À propos de l’offre d’emploi</h2>
        <p>Contribuez à des projets industriels innovants avec nos équipes techniques en France.</p>
      </div>`;
  return {
    pageUrl: linkedinUrl,
    pageTitle: mode === "RICH" ? "Concepteur mécanique H/F | SEGULA Technologies" : "LinkedIn",
    visibleText: "Unrelated page text",
    html: `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails">
      <main><div data-testid="lazy-column">
        <div id="JobDetails_ManageJobBanner_${linkedinId}"></div>
        ${header}
        <div data-testid="details-and-extras">${details}</div>
      </div></main>
    </div>`,
    capturedAt,
  };
}

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

      it("attaches bounded LinkedIn description-only recaptures only to an existing exact identity", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const rich = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("RICH", "2026-11-11T10:00:00Z"),
          );
          expect(rich.processing.status).toBe("PROCESSED");
          if (rich.processing.status !== "PROCESSED") throw Error("Expected an accepted rich capture.");
          const canonicalId = rich.processing.canonicalVacancyId;
          const before = db.prepare(`
            SELECT v.id, f.value_json AS title
            FROM canonical_vacancies v JOIN canonical_vacancy_fields f
              ON f.canonical_vacancy_id = v.id AND f.field_name = 'role'
            WHERE v.id = ?
          `).get(canonicalId) as { id: string; title: string };
          const roleBefore = JSON.parse(before.title) as { title: string };
          const employerCount = db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get();

          const partialPayload = linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T11:00:00Z");
          const partial = await runtime.captureAndProcessBrowserVacancy(partialPayload);
          expect(partial.processing).toMatchObject({
            status: "PROCESSED",
            canonicalVacancyId: canonicalId,
            vacancyOutcome: "UPDATED_EXISTING",
            observationAdded: true,
            employerStatus: "UNRESOLVED_EXISTING_RECORD",
          });
          expect(db.prepare(`
            SELECT canonical_vacancy_id FROM canonical_vacancy_observation_claims
            WHERE source_observation_id = ?
          `).get(partial.capture.observationId)).toEqual({ canonical_vacancy_id: canonicalId });
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual(employerCount);

          const after = await new SqliteCanonicalVacancyRepository(db).findById(canonicalId);
          expect(after?.role.value?.title).toBe(roleBefore.title);
          expect(after?.location.value?.rawText).toContain("Dunkerque");
          expect(after?.organizationRelationships).toContainEqual(
            expect.objectContaining({ role: "DISPLAYED_COMPANY", rawName: "SEGULA Technologies" }),
          );
          expect(after?.sourceObservationIds).toContain(partial.capture.observationId);
          const saved = await new SqliteSourceObservationRepository(db).findById(partial.capture.observationId);
          const savedAcquisition = saved?.metadata.acquisition as { contexts?: Array<{ text?: string }> };
          expect(savedAcquisition.contexts?.[0]?.text).toContain("Contribuez à des projets industriels");

          const replay = await runtime.captureAndProcessBrowserVacancy(partialPayload);
          expect(replay.capture.observationId).toBe(partial.capture.observationId);
          expect(replay.processing).toMatchObject({
            status: "PROCESSED",
            canonicalVacancyId: canonicalId,
            observationAdded: false,
          });
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancy_source_observations").get())
            .toEqual({ count: 2 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual(employerCount);
        } finally { db.close(); }
      });

      it("preserves prior description history when an accepted header-only capture follows", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const rich = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("RICH", "2026-11-11T18:00:00Z"),
          );
          if (rich.processing.status !== "PROCESSED") throw Error("Expected an accepted rich capture.");
          const header = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("HEADER_ONLY", "2026-11-11T19:00:00Z"),
          );
          expect(header.processing).toMatchObject({
            status: "PROCESSED",
            canonicalVacancyId: rich.processing.canonicalVacancyId,
            observationAdded: true,
          });
          const canonical = await new SqliteCanonicalVacancyRepository(db)
            .findById(rich.processing.canonicalVacancyId);
          expect(canonical?.sourceObservationIds).toHaveLength(2);
          const initial = await new SqliteSourceObservationRepository(db).findById(rich.capture.observationId);
          const initialAcquisition = initial?.metadata.acquisition as { contexts?: Array<{ text?: string }> };
          expect(initialAcquisition.contexts?.[0]?.text).toContain("Contribuez à des projets industriels");
        } finally { db.close(); }
      });

      it("surfaces changed bounded title and location as canonical conflicts", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const rich = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("RICH", "2026-11-11T20:00:00Z"),
          );
          if (rich.processing.status !== "PROCESSED") throw Error("Expected an accepted rich capture.");
          const changed = linkedinCapture("RICH", "2026-11-11T21:00:00Z");
          changed.html = changed.html
            .replace("Concepteur mécanique H/F", "Ingénieur logiciel senior")
            .replace("Dunkerque, Hauts-de-France, France", "Lyon, Auvergne-Rhône-Alpes, France");
          const result = await runtime.captureAndProcessBrowserVacancy(changed);
          expect(result.processing).toMatchObject({
            status: "PROCESSED",
            canonicalVacancyId: rich.processing.canonicalVacancyId,
            canonicalizationStatus: "CONFLICTED",
          });
          const canonical = await new SqliteCanonicalVacancyRepository(db)
            .findById(rich.processing.canonicalVacancyId);
          expect(canonical?.role.status).toBe("CONFLICTED");
          expect(canonical?.role.alternatives?.map(({ value }) => value.title)).toEqual(
            expect.arrayContaining(["Concepteur mécanique H/F", "Ingénieur logiciel senior"]),
          );
          expect(canonical?.location.status).toBe("CONFLICTED");
        } finally { db.close(); }
      });

      it("keeps description-only and identity-only LinkedIn captures unclaimed for new identities", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const description = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T12:00:00Z"),
          );
          expect(description.processing).toMatchObject({
            status: "VACANCY_NOT_DETECTED",
            rejectionReason: "NO_MEANINGFUL_VACANCY_EVIDENCE",
          });
          const identityOnlyPayload = linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T13:00:00Z");
          identityOnlyPayload.pageTitle = "Software Engineer";
          identityOnlyPayload.visibleText = "Software Engineer\nParis";
          identityOnlyPayload.html = identityOnlyPayload.html.replace(
            /<div data-testid="details-and-extras">[\s\S]*?<\/div>/u,
            `<div data-testid="details-and-extras"><div id="JobDetails_AboutTheJob_${linkedinId}" componentkey="JobDetails_AboutTheJob_${linkedinId}"><h2>À propos de l’offre d’emploi</h2></div></div>`,
          );
          const identityOnly = await runtime.captureAndProcessBrowserVacancy(identityOnlyPayload);
          expect(identityOnly.processing).toMatchObject({
            status: "VACANCY_NOT_DETECTED",
            rejectionReason: "NO_MEANINGFUL_VACANCY_EVIDENCE",
          });
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 0 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancy_observation_claims").get()).toEqual({ count: 0 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 0 });
        } finally { db.close(); }
      });

      it("does not attach to an existing identity when the LinkedIn locator is absent or mismatched", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const rich = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("RICH", "2026-11-11T22:00:00Z"),
          );
          if (rich.processing.status !== "PROCESSED") throw Error("Expected an accepted rich capture.");
          const badContext = linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T22:30:00Z");
          badContext.html = badContext.html.replaceAll(linkedinId, "4483996806");
          const badLocator = await runtime.captureAndProcessBrowserVacancy(badContext);
          expect(badLocator.processing).toMatchObject({
            status: "VACANCY_NOT_DETECTED",
            rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT",
          });

          const unbounded = linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T23:00:00Z");
          unbounded.html = "<main>Selected vacancy description without a bounded locator.</main>";
          const untrusted = await runtime.captureAndProcessBrowserVacancy(unbounded);
          expect(untrusted.processing).toMatchObject({
            status: "VACANCY_NOT_DETECTED",
            rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT",
          });
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancy_observation_claims").get()).toEqual({ count: 1 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
        } finally { db.close(); }
      });

      it("does not create an unresolved employer cluster when an attached partial has no employer evidence", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const rich = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("RICH", "2026-11-11T14:00:00Z"),
          );
          if (rich.processing.status !== "PROCESSED") throw Error("Expected an accepted rich capture.");
          db.prepare("DELETE FROM observation_cluster_assignments").run();
          db.prepare("DELETE FROM employer_clusters").run();

          const partial = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T15:00:00Z"),
          );
          expect(partial.processing).toMatchObject({
            status: "PROCESSED",
            canonicalVacancyId: rich.processing.canonicalVacancyId,
            employerStatus: "NO_EMPLOYER_EVIDENCE",
          });
          expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 0 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM observation_cluster_assignments").get()).toEqual({ count: 0 });
        } finally { db.close(); }
      });

      it("keeps human state, archive, and interaction history while reprojecting a partial recapture", async () => {
        const db = createDatabase(":memory:");
        try {
          const runtime = createCaptureProcessingRuntime(db);
          const rich = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("RICH", "2026-11-11T16:00:00Z"),
          );
          if (rich.processing.status !== "PROCESSED") throw Error("Expected an accepted rich capture.");
          const canonicalId = rich.processing.canonicalVacancyId;
          const assignment = db.prepare(`
            SELECT id FROM observation_cluster_assignments
            WHERE source_observation_id = ? AND superseded_at IS NULL
          `).get(rich.capture.observationId) as { id: string };
          db.prepare(`
            UPDATE observation_cluster_assignments
            SET status = 'USER_CONFIRMED', algorithm = 'user-employer-identity'
            WHERE id = ?
          `).run(assignment.id);
          db.prepare(`
            INSERT INTO vacancy_organization_role_decisions (
              id, canonical_vacancy_id, identity_key, organization_name, normalized_name,
              role, previous_decision_id, basis_json, override_acknowledged, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', 0, ?)
          `).run("human-role", canonicalId, "name:segula technologies", "SEGULA Technologies",
            "segula technologies", "STAFFING_AGENCY", "2026-11-11T16:10:00Z");
          db.prepare(`
            INSERT INTO user_vacancy_interaction_events (
              id, canonical_vacancy_id, event_type, occurred_at, recorded_at
            ) VALUES (?, ?, 'APPLIED', ?, ?)
          `).run("interaction", canonicalId, "2026-11-11T16:15:00Z", "2026-11-11T16:15:00Z");
          db.prepare(`
            INSERT INTO vacancy_cleanup_state (canonical_vacancy_id, archived_at)
            VALUES (?, ?)
          `).run(canonicalId, "2026-11-11T16:20:00Z");
          const humanAssignmentBefore = db.prepare(`
            SELECT employer_cluster_id, status, algorithm FROM observation_cluster_assignments WHERE id = ?
          `).get(assignment.id);

          const partial = await runtime.captureAndProcessBrowserVacancy(
            linkedinCapture("DESCRIPTION_ONLY", "2026-11-11T17:00:00Z"),
          );
          expect(partial.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
          expect(db.prepare(`
            SELECT employer_cluster_id, status, algorithm FROM observation_cluster_assignments WHERE id = ?
          `).get(assignment.id)).toEqual(humanAssignmentBefore);
          expect(db.prepare("SELECT archived_at FROM vacancy_cleanup_state WHERE canonical_vacancy_id = ?").get(canonicalId))
            .toEqual({ archived_at: "2026-11-11T16:20:00Z" });
          expect(db.prepare("SELECT COUNT(*) AS count FROM user_vacancy_interaction_events WHERE canonical_vacancy_id = ?").get(canonicalId))
            .toEqual({ count: 1 });
          expect(db.prepare("SELECT COUNT(*) AS count FROM vacancy_organization_role_decisions WHERE canonical_vacancy_id = ?").get(canonicalId))
            .toEqual({ count: 1 });
          const canonical = await new SqliteCanonicalVacancyRepository(db).findById(canonicalId);
          expect(canonical?.organizationRelationships).toContainEqual(
            expect.objectContaining({ rawName: "SEGULA Technologies", role: "STAFFING_AGENCY" }),
          );
          expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
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
