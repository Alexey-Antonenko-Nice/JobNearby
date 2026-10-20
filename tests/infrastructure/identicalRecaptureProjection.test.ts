import { describe, expect, it, vi } from "vitest";

import { CompositeVacancyEvidenceExtractor } from "../../src/application/evidence/CompositeVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";

describe("identical recapture reprojection", () => {
  it.each(["ACCEPTED", "USER_CONFIRMED"])(
    "refreshes derived evidence while preserving immutable source and %s employer history",
    async (assignmentStatus) => {
      const database = createDatabase(":memory:");
      const original = CompositeVacancyEvidenceExtractor.prototype.extract;
      let oldExtractor = true;
      const extract = vi.spyOn(CompositeVacancyEvidenceExtractor.prototype, "extract")
        .mockImplementation(async function (this: CompositeVacancyEvidenceExtractor, input) {
          const evidence = await original.call(this, input);
          return oldExtractor
            ? { ...evidence, workModes: [], compensations: [], organizations: [] }
            : evidence;
        });
      try {
        const runtime = createCaptureProcessingRuntime(database);
        const id = "4473114996";
        const payload = {
          pageUrl: `https://www.linkedin.com/jobs/view/ingenieur-${id}/`,
          pageTitle: "LinkedIn vacancy",
          visibleText: "Full LinkedIn page",
          capturedAt: "2026-10-19T10:00:00Z",
          html: `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails">
            <main id="workspace"><div data-testid="lazy-column" data-component-type="LazyColumn">
              <div id="JobDetails_ManageJobBanner_${id}"></div>
              <div data-testid="job-header">
                <a href="/jobs/view/ingenieur-${id}/">Eurofirms</a>
                <h1>Ingénieur Méthodes Industrialisation H/F</h1>
                <p>Toulouse, Occitanie, France · il y a 2 jours</p>
                <p>39K € par yr - 42K € par yr · Sur site · Temps plein</p>
              </div>
              <div data-testid="details-and-extras">
                <div id="JobDetails_AboutTheJob_${id}" componentkey="JobDetails_AboutTheJob_${id}">
                  <h2>À propos de l’offre d’emploi</h2>
                  <p>Eurofirms est un cabinet de recrutement. Our client recruits an engineer.</p>
                </div>
                <div id="JobDetails_AboutTheCompany_${id}">Company details</div>
              </div>
            </div></main>
          </div>`,
        };
        const first = await runtime.captureAndProcessBrowserVacancy(payload);
        if (first.processing.status !== "PROCESSED") throw new Error("Initial processing failed");
        const canonicalId = first.processing.canonicalVacancyId;
        const repository = new SqliteCanonicalVacancyRepository(database);
        const stale = await repository.findById(canonicalId);
        expect(stale?.workMode.status).toBe("UNKNOWN");
        expect(stale?.compensation.status).toBe("UNKNOWN");
        expect(stale?.organizationRelationships.map((item) => item.role)).toEqual(["EMPLOYER"]);
        database.prepare("UPDATE observation_cluster_assignments SET status = ?").run(assignmentStatus);
        const assignments = () => database.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
        const clusters = () => database.prepare("SELECT * FROM employer_clusters ORDER BY id").all();
        const sources = () => database.prepare("SELECT * FROM source_observations ORDER BY id").all();
        const originalAssignments = assignments();
        const originalClusters = clusters();
        const originalSources = sources();
        expect(originalAssignments).toHaveLength(1);
        expect(originalClusters).toEqual([expect.objectContaining({ status: "UNRESOLVED" })]);
        oldExtractor = false;
        extract.mockClear();

        // Only the extraction implementation changes; both captures have identical content.
        const second = await runtime.captureAndProcessBrowserVacancy({
          ...payload, capturedAt: "2026-10-20T10:00:00Z",
        });
        expect(second.capture.observationId).toBe(first.capture.observationId);
        expect(second.processing).toMatchObject({
          status: "PROCESSED", canonicalVacancyId: canonicalId,
          vacancyOutcome: "UPDATED_EXISTING", observationAdded: false,
        });
        expect(extract).toHaveBeenCalled();
        const refreshed = await repository.findById(canonicalId);
        expect(refreshed?.sourceObservationIds).toEqual([first.capture.observationId]);
        expect(refreshed?.workMode).toMatchObject({ status: "RESOLVED", value: "ON_SITE" });
        expect(refreshed?.compensation).toMatchObject({
          status: "RESOLVED",
          value: { minimum: 39000, maximum: 42000, currency: "EUR", period: "YEAR" },
        });
        expect(refreshed?.role.status).toBe("RESOLVED");
        expect(refreshed?.location.status).toBe("RESOLVED");
        expect(refreshed?.engagement).toMatchObject({
          status: "RESOLVED", value: { normalizedTerms: ["FULL_TIME"] },
        });
        expect(refreshed?.organizationRelationships).toEqual(expect.arrayContaining([
          expect.objectContaining({ rawName: "Eurofirms", role: "DISPLAYED_COMPANY" }),
          expect.objectContaining({ rawName: "Eurofirms", role: "RECRUITER" }),
          expect.objectContaining({ role: "EMPLOYER" }),
        ]));
        expect(refreshed?.organizationRelationships.find((item) => item.role === "EMPLOYER")?.rawName)
          .toBeUndefined();
        expect(sources()).toEqual(originalSources);
        expect(assignments()).toEqual(originalAssignments);
        expect(clusters()).toEqual(originalClusters);
        expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });

        const third = await runtime.captureAndProcessBrowserVacancy({
          ...payload, capturedAt: "2026-10-20T11:00:00Z",
        });
        expect(third.capture.observationId).toBe(first.capture.observationId);
        const repeated = await repository.findById(canonicalId);
        // Derivation timestamps may change; semantic state and provenance must not.
        const semantic = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) =>
          key === "derivedAt" ? undefined : item));
        expect(semantic(repeated)).toEqual(semantic(refreshed));
        expect(sources()).toEqual(originalSources);
        expect(assignments()).toEqual(originalAssignments);
        expect(clusters()).toEqual(originalClusters);
        expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 3 });

        const changed = await runtime.captureAndProcessBrowserVacancy({
          ...payload, html: payload.html.replace("Our client recruits", "Our client now recruits"),
          capturedAt: "2026-10-20T12:00:00Z",
        });
        expect(changed.capture.observationId).not.toBe(first.capture.observationId);
        expect(changed.processing).toMatchObject({
          status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: true,
        });
        expect(sources()).toHaveLength(2);
        expect(sources()).toEqual(expect.arrayContaining(originalSources));
        expect(clusters()).toEqual(originalClusters);
        expect(assignments()).toHaveLength(2);
      } finally {
        extract.mockRestore();
        database.close();
      }
    },
  );
});
