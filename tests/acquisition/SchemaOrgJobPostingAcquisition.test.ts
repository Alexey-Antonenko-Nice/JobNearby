import { describe, expect, it } from "vitest";

import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { LiteralJsonLdDocumentExtractor } from "../../src/application/acquisition/LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "../../src/application/acquisition/SchemaOrgJobPostingExtractor.js";
import { SchemaOrgJobPostingProjector } from "../../src/application/acquisition/SchemaOrgJobPostingProjector.js";

const documents = new LiteralJsonLdDocumentExtractor();
const postings = new SchemaOrgJobPostingExtractor();
const projector = new SchemaOrgJobPostingProjector();
const adapter = new BrowserCaptureAcquisitionAdapter();

function script(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}

function payload(html: string, pageUrl = "https://example.test/vacancy") {
  return {
    pageUrl,
    pageTitle: "Browser page title",
    visibleText: "Visible page text remains primary",
    capturedAt: "2026-08-28T12:00:00Z",
    html,
  };
}

describe("literal JSON-LD document extraction", () => {
  it("extracts a direct JSON-LD object without executing it", () => {
    const value = { "@type": "JobPosting", title: "Engineer" };
    expect(documents.extract(`<html>${script(value)}</html>`)).toEqual([value]);
  });

  it("inspects multiple JSON-LD scripts and ignores other scripts", () => {
    const html = `${script({ "@type": "BreadcrumbList" })}
      <script>throw new Error("must not run")</script>
      ${script({ "@type": "JobPosting", title: "Role" })}`;
    expect(documents.extract(html)).toHaveLength(2);
  });

  it("accepts case-insensitive and reordered script attributes", () => {
    const html = `<SCRIPT data-test="x" TYPE='application/ld+json'>
      {"@type":"JobPosting"}
    </SCRIPT>`;
    expect(documents.extract(html)).toEqual([{ "@type": "JobPosting" }]);
  });

  it("skips malformed JSON-LD without failing extraction", () => {
    const html = `<script type="application/ld+json">{invalid</script>
      ${script({ "@type": "JobPosting", title: "Survives" })}`;
    expect(documents.extract(html)).toEqual([{ "@type": "JobPosting", title: "Survives" }]);
  });

  it("returns no documents when JSON-LD is absent", () => {
    expect(documents.extract("<html><body>Vacancy</body></html>")).toEqual([]);
  });
});

describe("Schema.org JobPosting detection", () => {
  it("detects a JobPosting in an array root", () => {
    expect(postings.extract([[{ "@type": "BreadcrumbList" }, { "@type": "JobPosting", title: "Role" }]]))
      .toEqual([{ "@type": "JobPosting", title: "Role" }]);
  });

  it("detects a JobPosting in an @graph root", () => {
    expect(postings.extract([{
      "@context": "https://schema.org",
      "@graph": [{ "@type": "Organization" }, { "@type": "JobPosting", title: "Role" }],
    }])).toEqual([{ "@type": "JobPosting", title: "Role" }]);
  });

  it("supports an @type array containing JobPosting", () => {
    expect(postings.extract([{ "@type": ["Thing", "JobPosting"], title: "Role" }]))
      .toHaveLength(1);
  });

  it("ignores non-JobPosting JSON-LD", () => {
    expect(postings.extract([{ "@type": "Organization" }])).toEqual([]);
  });
});

describe("conservative JobPosting projection", () => {
  it("projects directly represented fields", () => {
    expect(projector.project({
      "@type": "JobPosting",
      title: " Field Service Engineer ",
      hiringOrganization: { "@type": "Organization", name: "Supplay" },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Strasbourg",
          addressRegion: "Grand Est",
          addressCountry: "FR",
        },
      },
      datePosted: "2026-08-27T17:15:40Z",
      employmentType: "FULL_TIME",
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "EUR",
        value: { "@type": "QuantitativeValue", minValue: 30000, maxValue: 35000, unitText: "YEAR" },
      },
    })).toEqual({
      title: "Field Service Engineer",
      displayedCompanyName: "Supplay",
      locationText: "Strasbourg, Grand Est, FR",
      publishedAt: new Date("2026-08-27T17:15:40Z"),
      contractText: "FULL_TIME",
      salaryText: "30000 - 35000 EUR / YEAR",
    });
  });

  it("projects a simple named location and exact salary", () => {
    expect(projector.project({
      "@type": "JobPosting",
      jobLocation: { "@type": "Place", name: "Weyersheim, France" },
      baseSalary: { currency: "EUR", value: { value: 16, unitText: "HOUR" } },
    })).toEqual({ locationText: "Weyersheim, France", salaryText: "16 EUR / HOUR" });
  });

  it("ignores malformed optional fields rather than failing", () => {
    expect(projector.project({
      "@type": "JobPosting",
      title: 42,
      datePosted: "not-a-date",
      employmentType: { value: "FULL_TIME" },
      jobLocation: [{ name: "A" }, { name: "B" }],
      baseSalary: { value: {} },
    })).toBeUndefined();
  });
});

describe("browser JobPosting acquisition integration", () => {
  it("extracts a Hellowork-style fixture generically and preserves the original object", () => {
    const jobPosting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      identifier: { "@type": "PropertyValue", name: "Supplay", value: "30683633 UZO8396A3ZWR" },
      title: "Technicien Méthodes - CDI H/F",
      description: "Full structured description",
      hiringOrganization: { "@type": "Organization", name: "Supplay" },
      jobLocation: { "@type": "Place", address: { addressLocality: "Soultz-sous-Forêts", addressCountry: "FR" } },
      datePosted: "2026-08-27T17:15:40Z",
      validThrough: "2026-09-27T17:15:40Z",
      employmentType: "FULL_TIME",
      baseSalary: { currency: "EUR", value: { minValue: 30000, maxValue: 35000, unitText: "YEAR" } },
      skills: "Methods",
    };
    const result = adapter.toAcquisitionPackage(
      payload(`<html>${script(jobPosting)}</html>`, "https://generic.example/jobs/82745536"),
      "acquisition-hellowork-style",
    );
    expect(result.structuredFields).toMatchObject({
      title: "Technicien Méthodes - CDI H/F",
      displayedCompanyName: "Supplay",
      locationText: "Soultz-sous-Forêts, FR",
      contractText: "FULL_TIME",
    });
    expect(result.content.structuredPayload).toEqual({
      format: "SCHEMA_ORG_JOB_POSTING_JSON_LD",
      jobPostings: [jobPosting],
    });
    expect(result.externalId).toBeUndefined();
    expect(result.content.text).toBe("Visible page text remains primary");
  });

  it("extracts a Meteojob-style fixture without provider-specific logic", () => {
    const jobPosting = {
      "@type": "JobPosting",
      title: "Technicien Robotique (H/F)",
      hiringOrganization: { name: "RE'FLEX SERVICES" },
      jobLocation: { address: { addressLocality: "Haguenau", addressRegion: "Grand Est", addressCountry: "FR" } },
      datePosted: "2026-08-27T16:49:47.889Z",
      employmentType: "FULL_TIME",
      jobLocationType: "TELECOMMUTE",
      workHours: "35 hours",
      applicantLocationRequirements: { name: "France" },
    };
    const result = adapter.toAcquisitionPackage(
      payload(script(jobPosting), "https://another.example/jobs/56378291"),
      "acquisition-meteojob-style",
    );
    expect(result.structuredFields).toMatchObject({
      title: "Technicien Robotique (H/F)",
      displayedCompanyName: "RE'FLEX SERVICES",
      locationText: "Haguenau, Grand Est, FR",
    });
    expect(result.content.structuredPayload).toEqual(expect.objectContaining({ jobPostings: [jobPosting] }));
  });

  it("retains multiple postings without selecting a projection winner", () => {
    const first = { "@type": "JobPosting", title: "First" };
    const second = { "@type": "JobPosting", title: "Second" };
    const result = adapter.toAcquisitionPackage(
      payload(`${script(first)}${script(second)}`),
      "acquisition-multiple",
    );
    expect(result.structuredFields).toBeUndefined();
    expect(result.content.structuredPayload).toEqual(expect.objectContaining({
      jobPostings: [first, second],
    }));
  });

  it("continues ordinary capture when JSON-LD is absent, malformed, or not a JobPosting", () => {
    for (const html of [
      "<html><main>Indeed-style selected job</main></html>",
      `<script type="application/ld+json">{bad</script>`,
      script({ "@type": "WebSite", name: "LinkedIn-style page" }),
    ]) {
      const result = adapter.toAcquisitionPackage(payload(html), "acquisition-fallback");
      expect(result.content.text).toBe("Visible page text remains primary");
      expect(result.content.structuredPayload).toBeUndefined();
      expect(result.structuredFields).toBeUndefined();
    }
  });

  it("maps projected fields and raw JobPosting traceability into SourceObservation safely", () => {
    const jobPosting = {
      "@type": "JobPosting",
      title: "Role",
      hiringOrganization: { name: "Recruitment Intermediary" },
      identifier: { value: "recruiter-reference" },
      validThrough: "2026-12-31",
    };
    const acquisition = adapter.toAcquisitionPackage(payload(script(jobPosting)), "acquisition-mapped");
    const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(
      acquisition,
      "observation-mapped",
    );
    expect(observation.title).toBe("Role");
    expect(observation.displayedCompanyName).toBe("Recruitment Intermediary");
    expect(observation.source.externalId).toBeUndefined();
    expect(observation.publishedAt).toBeUndefined();
    expect(observation).not.toHaveProperty("employer");
    expect(observation.metadata.acquisition).toEqual(expect.objectContaining({
      structuredPayload: expect.objectContaining({ jobPostings: [jobPosting] }),
    }));
  });
});
