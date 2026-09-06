import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();

function page(slug: string, title: string, location: string, employmentType: string, requisition: string, organization = "Bürkert Fluid Control Systems"): string {
  return `<article itemscope itemtype="https://schema.org/JobPosting" data-page-type="job">
    <h1 itemprop="title">${title}</h1>
    <meta itemprop="employmentType" content="${employmentType}">
    <span itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><meta itemprop="sameAs" content="https://www.burkert.com/"><h4 itemprop="name">${organization}</h4></span>
    <span itemprop="jobLocation" itemscope itemtype="https://schema.org/Place"><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress"><meta itemprop="addressLocality" content="${location}"></div></span>
    <a href="https://burkert.wd502.myworkdayjobs.com/de-DE/burkert-career/job/x/${title.replace(/\s+/gu, "-")}_${requisition}/apply?source=3775327">Apply now</a>
  </article>`;
}

function capture(url: string, html: string, id: string) {
  const acquisition = adapter.toAcquisitionPackage({
    pageUrl: url, pageTitle: "Bürkert", visibleText: "Vacancy page", capturedAt: "2026-09-06T12:00:00Z", html,
  }, `acquisition-${id}`);
  return { acquisition, observation: mapper.toSourceObservation(acquisition, id) };
}

describe("Bürkert direct vacancy acquisition", () => {
  it("uses Workday requisitions as stable IDs and keeps URL variants equivalent", () => {
    const html = page("teamleiter-kunststofftechnik-m-w-d", "Teamleiter Kunststofftechnik (m/w/d)", "Ingelfingen-Criesbach", "FULL_TIME", "JR_00001287");
    const first = capture("https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d", html, "german");
    const second = capture("https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d?utm_source=test#top", html, "german-variant");
    expect(first.acquisition.externalId).toBe("JR_00001287");
    expect(second.acquisition.externalId).toBe("JR_00001287");
    expect(first.observation.title).toBe("Teamleiter Kunststofftechnik (m/w/d)");
    expect(first.observation.locationText).toBe("Ingelfingen-Criesbach");
    expect(first.observation.displayedCompanyName).toBe("Bürkert Fluid Control Systems");
  });

  it("extracts the French title, workplace, organization, and engagement", () => {
    const { acquisition, observation } = capture(
      "https://www.burkert.com/en/company-career/career/job-openings/technicien-ne-maintenance-et-equipements",
      page("technicien-ne-maintenance-et-equipements", "Technicien(-ne) Maintenance et équipements", "Triembach-au-Val", "FULL_TIME", "JR_00001306"),
      "french",
    );
    expect(acquisition.externalId).toBe("JR_00001306");
    expect(observation.title).toBe("Technicien(-ne) Maintenance et équipements");
    expect(observation.locationText).toBe("Triembach-au-Val");
    expect(observation.displayedCompanyName).toBe("Bürkert Fluid Control Systems");
    expect(observation.contractText).toBe("FULL_TIME");
  });

  it("falls back to the scoped vacancy slug and rejects non-vacancy routes", () => {
    const withNoApply = page("teamleiter-kunststofftechnik-m-w-d", "Teamleiter Kunststofftechnik (m/w/d)", "Ingelfingen-Criesbach", "FULL_TIME", "NO_ID").replace(/<a href=[^>]+>Apply now<\/a>/u, "");
    const valid = capture("https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d", withNoApply, "slug");
    expect(valid.acquisition.externalId).toBe("teamleiter-kunststofftechnik-m-w-d");
    const unrelated = capture("https://www.burkert.com/en/company-career", withNoApply, "unrelated");
    expect(unrelated.acquisition.externalId).toBeUndefined();
  });

  it("leaves missing workplace evidence unknown", () => {
    const html = page("teamleiter-kunststofftechnik-m-w-d", "Teamleiter Kunststofftechnik (m/w/d)", "Ingelfingen-Criesbach", "FULL_TIME", "JR_00001287").replace(/<span itemprop="jobLocation"[\s\S]*?<\/span>/u, "");
    expect(capture("https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d", html, "missing-location").observation.locationText).toBeUndefined();
  });

  it("does not treat a location-scope name as the hiring organization", () => {
    const html = `<article itemscope itemtype="https://schema.org/JobPosting">
      <h1 itemprop="title">Teamleiter Kunststofftechnik (m/w/d)</h1>
      <span itemprop="jobLocation" itemscope itemtype="https://schema.org/Place">
        <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
          <meta itemprop="name" content="Bürkert Fluid Control Systems">
          <meta itemprop="addressLocality" content="Ingelfingen-Criesbach">
          <meta itemprop="addressCountry" content="Germany">
        </div>
      </span>
    </article>`;
    const result = capture("https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d", html, "scope-boundary");
    expect(result.observation.locationText).toBe("Ingelfingen-Criesbach");
    expect(result.observation.displayedCompanyName).toBeUndefined();
  });

  it("keeps the real Bürkert location block from creating a probable employer", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const html = `<article itemscope itemtype="https://schema.org/JobPosting">
        <h1 itemprop="title">Teamleiter Kunststofftechnik (m/w/d)</h1>
        <span itemprop="jobLocation" itemscope itemtype="https://schema.org/Place"><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress"><meta itemprop="name" content="Bürkert Fluid Control Systems"><meta itemprop="addressLocality" content="Ingelfingen-Criesbach"><meta itemprop="addressCountry" content="Germany"></div></span>
        <address><h3>Location</h3><span itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><h4 itemprop="name">Ingelfingen-Criesbach / Germany</h4></span><span itemprop="jobLocation" itemscope itemtype="https://schema.org/Place"><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress"><meta itemprop="addressLocality" content="Ingelfingen-Criesbach"></div></span></address>
      </article>`;
      const result = await runtime.captureAndProcessBrowserVacancy({
        pageUrl: "https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d",
        pageTitle: "Bürkert", visibleText: "Vacancy", capturedAt: "2026-09-06T12:00:00Z", html,
      });
      expect(result.processing.status).toBe("PROCESSED");
      if (result.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      expect(db.prepare("SELECT status FROM employer_clusters").all()).toEqual([{ status: "UNRESOLVED" }]);
    } finally {
      db.close();
    }
  });

  it("converges repeated unchanged captures into one observation and vacancy", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const payload = {
        pageUrl: "https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d",
        pageTitle: "Bürkert", visibleText: "Vacancy page", html: page("teamleiter-kunststofftechnik-m-w-d", "Teamleiter Kunststofftechnik (m/w/d)", "Ingelfingen-Criesbach", "FULL_TIME", "JR_00001287"),
      };
      const first = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-09-06T12:00:00Z" });
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-09-06T12:01:00Z" });
      expect(first.processing.status).toBe("PROCESSED");
      expect(second.processing.status).toBe("PROCESSED");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") throw new Error("Expected processing to succeed.");
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT status, value_json FROM canonical_vacancy_fields WHERE canonical_vacancy_id = ? AND field_name IN ('role', 'location') ORDER BY field_name").all(first.processing.canonicalVacancyId)).toEqual([
        { status: "RESOLVED", value_json: JSON.stringify({ rawText: "Ingelfingen-Criesbach" }) },
        { status: "RESOLVED", value_json: JSON.stringify({ title: "Teamleiter Kunststofftechnik (m/w/d)" }) },
      ]);
      expect(db.prepare("SELECT raw_name, role FROM canonical_vacancy_organization_relationships WHERE canonical_vacancy_id = ?").all(first.processing.canonicalVacancyId)).toEqual(expect.arrayContaining([
        { raw_name: "Bürkert Fluid Control Systems", role: "DISPLAYED_COMPANY" },
        { raw_name: "Bürkert Fluid Control Systems", role: "EMPLOYER" },
      ]));

      const changed = await runtime.captureAndProcessBrowserVacancy({
        ...payload,
        visibleText: "Vacancy page with changed content",
        capturedAt: "2026-09-06T12:02:00Z",
      });
      expect(changed.processing.status).toBe("PROCESSED");
      if (changed.processing.status !== "PROCESSED") throw new Error("Expected changed processing to succeed.");
      expect(changed.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_vacancies").get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});