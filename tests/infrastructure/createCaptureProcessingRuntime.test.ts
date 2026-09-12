import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

describe("createCaptureProcessingRuntime", () => {
  it("canonicalizes the selected Indeed vacancy facts without UI headings", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const id = "cdbdba0dee4cec36";
      const result = await runtime.captureAndProcessBrowserVacancy({
        pageUrl: `https://fr.indeed.com/?vjk=${id}`,
        pageTitle: "Indeed",
        visibleText: "Full Indeed page",
        capturedAt: "2026-09-06T11:00:00Z",
        html: `<main>
          <div class="cardOutline result job_${id} vjs-highlight"><a data-jk="${id}">Selected result</a></div>
          <section id="job-full-details" class="jobsearch-ViewJobContainerWrapper">
            <h2 data-testid="jobTitle">Technicien de maintenance H/F - job post</h2>
            <div data-testid="inlineHeader-companyName"><a href="/cmp/eurobrillance?fromjk=${id}">EUROBRILLANCE</a></div>
            <div data-testid="inlineHeader-companyLocation">67120 Altorf</div>
            <p>CDI, Temps plein</p>
          </section>
        </main>`,
      });
      expect(result.processing.status).toBe("PROCESSED");
      if (result.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      const fields = database.prepare(`
        SELECT field_name, status, value_json
        FROM canonical_vacancy_fields
        WHERE canonical_vacancy_id = ?
      `).all(result.processing.canonicalVacancyId) as Array<{ field_name: string; status: string; value_json: string | null }>;
      const field = (name: string) => fields.find(({ field_name }) => field_name === name);
      expect(field("role")).toMatchObject({ status: "RESOLVED", value_json: JSON.stringify({ title: "Technicien de maintenance H/F" }) });
      expect(field("location")).toMatchObject({ status: "RESOLVED", value_json: JSON.stringify({ rawText: "67120 Altorf" }) });
      const relationships = database.prepare(`
        SELECT raw_name, role
        FROM canonical_vacancy_organization_relationships
        WHERE canonical_vacancy_id = ?
      `).all(result.processing.canonicalVacancyId);
      expect(relationships).toContainEqual({ raw_name: "EUROBRILLANCE", role: "DISPLAYED_COMPANY" });
      expect(relationships).not.toContainEqual({ raw_name: "Job Post Details", role: "DISPLAYED_COMPANY" });
    } finally {
      database.close();
    }
  });

  it("canonicalizes Daimler Truck's single structured job location", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const result = await runtime.captureAndProcessBrowserVacancy({
        pageUrl: "https://jobsearch.daimlertruck.com/index.php?ac=jobad&id=425026",
        pageTitle: "Peintre Industriel (H/F)",
        visibleText: "Peintre Industriel (H/F)",
        capturedAt: "2026-09-06T10:00:00Z",
        html: `<script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Peintre Industriel (H/F)",
          hiringOrganization: {
            "@type": "Organization",
            name: "Mercedes-Benz Trucks Molsheim SASU",
            address: { addressLocality: "Must not become vacancy location" },
          },
          jobLocation: [{
            "@type": "Place",
            address: {
              "@type": "PostalAddress",
              addressLocality: "MOLSHEIM",
              addressRegion: "Daimler Truck - FR",
              postalCode: "67129",
              addressCountry: "FR",
            },
          }],
          employmentType: "FULL_TIME",
        })}</script>`,
      });
      expect(result.processing.status).toBe("PROCESSED");
      if (result.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      expect(database.prepare(`
        SELECT status, value_json
        FROM canonical_vacancy_fields
        WHERE canonical_vacancy_id = ? AND field_name = 'location'
      `).get(result.processing.canonicalVacancyId)).toEqual({
        status: "RESOLVED",
        value_json: JSON.stringify({ rawText: "MOLSHEIM, Daimler Truck - FR, FR" }),
      });
    } finally {
      database.close();
    }
  });

  it("preserves Daimler Truck hiring organization as displayed company and explicit employer", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const company = "Mercedes-Benz Trucks Molsheim SASU";
      const result = await runtime.captureAndProcessBrowserVacancy({
        pageUrl: "https://jobsearch.daimlertruck.com/index.php?ac=jobad&id=425092",
        pageTitle: "Daimler Truck vacancy",
        visibleText: "Technicien de maintenance",
        capturedAt: "2026-09-05T10:00:00Z",
        html: `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", hiringOrganization: { "@type": "Organization", name: company } })}</script>`,
      });
      expect(result.processing).toMatchObject({
        status: "PROCESSED",
        employerStatus: "IDENTIFIED_NEW_RECORD",
        employerDisplayName: company,
      });
      if (result.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      const relationships = database.prepare(`
        SELECT raw_name, role
        FROM canonical_vacancy_organization_relationships
        WHERE canonical_vacancy_id = ?
      `).all(result.processing.canonicalVacancyId);
      expect(relationships).toEqual(expect.arrayContaining([
        { raw_name: company, role: "DISPLAYED_COMPANY" },
        { raw_name: company, role: "EMPLOYER" },
      ]));
      expect(database.prepare(`
        SELECT status, display_label
        FROM employer_clusters
        WHERE id = (
          SELECT employer_cluster_id
          FROM observation_cluster_assignments
          WHERE source_observation_id = ?
        )
      `).get(result.capture.observationId)).toEqual({
        status: "PROBABLY_RESOLVED",
        display_label: company,
      });
    } finally {
      database.close();
    }
  });

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
        .toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get())
        .toEqual({ count: 2 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canonical_vacancy_source_observations
        WHERE canonical_vacancy_id = ?
      `).get(first.processing.canonicalVacancyId)).toEqual({ count: 1 });
      expect(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }]);
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
