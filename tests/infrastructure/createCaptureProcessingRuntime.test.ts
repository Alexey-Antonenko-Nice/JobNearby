import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

describe("createCaptureProcessingRuntime", () => {
  it("uses one migrated SQLite database to persist repeated exact-identity captures into one history", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const payload = {
        pageUrl: "https://www.hellowork.com/fr-fr/emplois/123",
        pageTitle: "Maintenance role",
        visibleText: "Technicien Maintenance\nExample employer\nStrasbourg",
        capturedAt: "2026-08-30T10:00:00Z",
      };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      const second = await runtime.captureAndProcessBrowserVacancy({
        ...payload,
        capturedAt: "2026-08-30T11:00:00Z",
      });
      expect(first.processing.status).toBe("PROCESSED");
      expect(second.processing.status).toBe("PROCESSED");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") {
        throw new Error("Expected processing to succeed.");
      }
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(second.processing.vacancyOutcome).toBe("UPDATED_EXISTING");
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get())
        .toEqual({ count: 2 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canonical_vacancy_source_observations
        WHERE canonical_vacancy_id = ?
      `).get(first.processing.canonicalVacancyId)).toEqual({ count: 2 });
      expect(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM user_vacancy_interaction_events").get())
        .toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("reuses one canonical vacancy across LinkedIn search-results and direct-view URL forms", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const id = "4449077982";
      const searchHtml = `<div componentkey="job-card-component-ref-${id}">Selected vacancy</div>
        <div id="JobDetails_AboutTheJob_${id}" componentkey="JobDetails_AboutTheJob_${id}">Description</div>`;
      const directHtml = `<div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails">
        <main id="workspace"><div data-testid="lazy-column" data-component-type="LazyColumn">
          <div id="JobDetails_ManageJobBanner_${id}"></div>
          <div><a href="/jobs/view/ingenieur-conception-mecanique-h-f-at-akkodis-${id}/">Akkodis</a>
            <h1>Ingénieur conception mécanique H/F</h1><p>Pays de la Loire, France</p>
            <p>Promue par un recruteur</p><p>Hybride</p><p>CDD</p></div>
          <div><div id="JobDetails_AboutTheJob_${id}" componentkey="JobDetails_AboutTheJob_${id}">
            <p>Consulting &amp; Solutions d'Akkodis France accompagne ce projet.</p>
          </div><div id="JobDetailsSimilarJobsSlot_${id}">Other jobs</div></div>
        </div></main>
      </div>`;
      const common = {
        pageTitle: "LinkedIn vacancy",
        visibleText: "Full LinkedIn page",
      };
      const first = await runtime.captureAndProcessBrowserVacancy({
        ...common,
        html: searchHtml,
        pageUrl: `https://www.linkedin.com/jobs/search-results/?currentJobId=${id}`,
        capturedAt: "2026-08-31T10:00:00Z",
      });
      const second = await runtime.captureAndProcessBrowserVacancy({
        ...common,
        html: directHtml,
        pageUrl: `https://www.linkedin.com/jobs/view/ingenieur-conception-mecanique-h-f-at-akkodis-${id}/`,
        capturedAt: "2026-08-31T11:00:00Z",
      });

      expect(first.processing.status).toBe("PROCESSED");
      expect(second.processing.status).toBe("PROCESSED");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") {
        throw new Error("Expected LinkedIn processing to succeed.");
      }
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(second.processing.vacancyOutcome).toBe("UPDATED_EXISTING");
      const fields = database.prepare(`
        SELECT field_name, status, value_json
        FROM canonical_vacancy_fields
        WHERE canonical_vacancy_id = ?
      `).all(first.processing.canonicalVacancyId) as Array<{
        field_name: string;
        status: string;
        value_json: string | null;
      }>;
      const field = (name: string) => fields.find(({ field_name }) => field_name === name);
      expect(field("role")).toMatchObject({
        status: "RESOLVED",
        value_json: JSON.stringify({ title: "Ingénieur conception mécanique H/F" }),
      });
      expect(field("location")).toMatchObject({
        status: "RESOLVED",
        value_json: JSON.stringify({ rawText: "Pays de la Loire, France" }),
      });
      expect(field("engagement")).toMatchObject({ status: "RESOLVED" });
      expect(field("workMode")).toMatchObject({
        status: "RESOLVED",
        value_json: JSON.stringify("HYBRID"),
      });
      const relationships = database.prepare(`
        SELECT raw_name, role
        FROM canonical_vacancy_organization_relationships
        WHERE canonical_vacancy_id = ?
      `).all(first.processing.canonicalVacancyId);
      expect(relationships).toEqual(expect.arrayContaining([
        { raw_name: "Akkodis", role: "DISPLAYED_COMPANY" },
        { raw_name: "Akkodis France", role: "CONSULTANCY" },
      ]));
    } finally {
      database.close();
    }
  });
});
