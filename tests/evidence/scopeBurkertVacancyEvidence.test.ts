import { describe, expect, it } from "vitest";

import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeBurkertVacancyEvidence } from "../../src/application/evidence/scopeBurkertVacancyEvidence.js";
import { scopeProviderVacancyEvidence } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

const adapter = new BrowserCaptureAcquisitionAdapter();
const mapper = new DeterministicAcquisitionCaptureMapper();
const URL_ = "https://www.burkert.com/en/company-career/career/job-openings/teamleiter-kunststofftechnik-m-w-d";
const POISON = /POISON|Foreign Title|Foreign Co|Foreign City|FOREIGN-CDD|foreign@example/iu;

function article(requisition: string | undefined = "JR_00001287"): string {
  const apply = requisition === undefined ? "" : `<a href="https://burkert.wd502.myworkdayjobs.com/de-DE/burkert-career/job/x/Teamleiter_${requisition}/apply?source=1">Apply now</a>`;
  return `<article itemscope itemtype="https://schema.org/JobPosting">
    <h1 itemprop="title">Teamleiter Kunststofftechnik (m/w/d)</h1>
    <meta itemprop="employmentType" content="FULL_TIME">
    <span itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><h4 itemprop="name">Bürkert Fluid Control Systems</h4></span>
    <span itemprop="jobLocation" itemscope itemtype="https://schema.org/Place"><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress"><meta itemprop="addressLocality" content="Ingelfingen-Criesbach"></div></span>
    ${apply}
  </article>`;
}
const foreignLd = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "JobPosting", title: "POISON Foreign Title",
  hiringOrganization: { "@type": "Organization", name: "POISON Foreign Co" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "POISON Foreign City" } },
  employmentType: "FOREIGN-CDD",
})}</script>`;
const page = (body: string) => `<html><body>${body}</body></html>`;

function capture(html: string, url = URL_): SourceObservation {
  const acquisition = adapter.toAcquisitionPackage({ pageUrl: url, pageTitle: "Bürkert", visibleText: "Vacancy page", capturedAt: "2026-09-06T12:00:00Z", html }, "acquisition");
  return mapper.toSourceObservation(acquisition, "observation");
}
function poisoned(observation: SourceObservation): SourceObservation {
  const acquisition = observation.metadata.acquisition as Record<string, unknown>;
  return {
    ...observation,
    title: "POISON Foreign Title", displayedCompanyName: "POISON Foreign Co", locationText: "POISON Foreign City", contractText: "FOREIGN-CDD",
    description: "POISON foreign description", contactText: "POISON foreign@example.test", rawContent: "POISON Foreign Title at Foreign Co",
    metadata: { ...observation.metadata, acquisition: { ...acquisition, structuredPayload: { format: "SCHEMA_ORG_JOB_POSTING_JSON_LD", jobPostings: [{
      title: "POISON Foreign Title", hiringOrganization: { name: "POISON Foreign Co" },
    }] } } },
  };
}
const evidenceOf = (observation: SourceObservation) => createVacancyEvidenceExtractor().extract(observation);
const accepted = async (observation: SourceObservation) => (await assessBrowserVacancyCapture(observation, createVacancyEvidenceExtractor())).captureAcceptedAsVacancy;

describe("Bürkert bounded evidence scope", () => {
  it("accepts and extracts a lone microdata posting with parity", async () => {
    const observation = capture(page(article()));
    expect(observation.source.externalId).toBe("JR_00001287");
    expect(await accepted(observation)).toBe(true);
    const evidence = await evidenceOf(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Teamleiter Kunststofftechnik (m/w/d)"]);
    expect(evidence.locations.map(l => l.value)).toContain("Ingelfingen-Criesbach");
    expect(scopeBurkertVacancyEvidence(observation).contractText).toBe("FULL_TIME");
    expect(evidence.organizations.map(o => o.role)).toContain("EMPLOYER");
    expect(evidence.organizations.every(o => o.value === "Bürkert Fluid Control Systems")).toBe(true);
  });

  it("excludes a foreign page-level JSON-LD posting everywhere", async () => {
    const observation = capture(page(foreignLd + article()));
    expect(await accepted(observation)).toBe(true);
    const evidence = await evidenceOf(observation);
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Teamleiter Kunststofftechnik (m/w/d)"]);
    expect(evidence.organizations.every(o => o.value === "Bürkert Fluid Control Systems")).toBe(true);
    expect(evidence.locations.map(l => l.value)).toContain("Ingelfingen-Criesbach");
  });

  it("leaks nothing from two foreign JSON-LD postings", async () => {
    const evidence = await evidenceOf(capture(page(foreignLd + article() + foreignLd)));
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence.vacancyTitles).toHaveLength(1);
  });

  it("fails closed for multiple JobPosting articles", async () => {
    const observation = capture(page(article() + article("JR_00001999")));
    expect(await accepted(observation)).toBe(false);
    const evidence = await evidenceOf(observation);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
  });

  it("fails closed for conflicting apply-link requisitions", async () => {
    const html = page(article().replace("</article>", `<a href="https://burkert.wd502.myworkdayjobs.com/x/Other_JR_00009999/apply">Apply</a></article>`));
    const observation = capture(html);
    expect(observation.source.externalId).toBeUndefined();
    expect(await accepted(observation)).toBe(false);
    expect((await evidenceOf(observation)).vacancyTitles).toEqual([]);
  });

  it("ignores a neighbour apply link outside the article and keeps the article identity", async () => {
    const outside = `<a href="https://burkert.wd502.myworkdayjobs.com/x/Other_JR_00009999/apply">Apply</a>`;
    const observation = capture(page(article() + outside));
    expect(observation.source.externalId).toBe("JR_00001287");
    expect(await accepted(observation)).toBe(true);
    expect(JSON.stringify(await evidenceOf(observation))).not.toMatch(/JR_00009999/u);
  });

  it("does not trust a lone apply link outside the article as vacancy identity", async () => {
    const outside = `<a href="https://burkert.wd502.myworkdayjobs.com/x/Other_JR_00009999/apply">Apply</a>`;
    const observation = capture(page(article("").replace(/<a href=[^>]+>Apply now<\/a>/u, "") + outside));
    expect(observation.source.externalId).toBe("teamleiter-kunststofftechnik-m-w-d");
    expect(JSON.stringify(await evidenceOf(observation))).not.toMatch(/JR_00009999/u);
  });

  it("fails closed when the source external ID disagrees with the article identity", async () => {
    const observation = capture(page(article()));
    const conflicting = { ...observation, source: { ...observation.source, externalId: "JR_00005555" } };
    expect(await accepted(conflicting)).toBe(false);
    expect((await evidenceOf(conflicting)).vacancyTitles).toEqual([]);
  });

  it("fails closed when the bounded article lacks required identity", async () => {
    const noTitle = capture(page(article().replace(/<h1[\s\S]*?<\/h1>/u, "")));
    expect(await accepted(noTitle)).toBe(false);
    const wrongRoute = capture(page(article()), "https://www.burkert.com/en/company-career");
    expect(await accepted(wrongRoute)).toBe(false);
    expect((await evidenceOf(wrongRoute)).vacancyTitles).toEqual([]);
    const wrongHost = capture(page(article()), "https://evil.example/en/company-career/career/job-openings/x");
    expect(await accepted(wrongHost)).toBe(false);
  });

  it("ignores poisoned page-level fields, rawContent, structuredPayload and contactText", async () => {
    const observation = poisoned(capture(page(foreignLd + article())));
    const evidence = await evidenceOf(observation);
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Teamleiter Kunststofftechnik (m/w/d)"]);
    expect(evidence.organizations.every(o => o.value === "Bürkert Fluid Control Systems")).toBe(true);
    const scoped = scopeBurkertVacancyEvidence(observation);
    expect(scoped.contactText).toBeUndefined();
    expect(scoped.rawContent ?? "").not.toMatch(POISON);
    expect(JSON.stringify(scoped.metadata)).not.toMatch(POISON);
  });

  it("keeps a neighbouring organization out of EMPLOYER evidence", async () => {
    const observation = poisoned(capture(page(foreignLd + article())));
    const evidence = await evidenceOf(observation);
    expect(evidence.organizations.filter(o => o.role === "EMPLOYER").map(o => o.value)).toEqual(["Bürkert Fluid Control Systems"]);
  });

  it("keeps a neighbour-only page failing closed with no employer", async () => {
    const evidence = await evidenceOf(poisoned(capture(page(foreignLd))));
    expect(JSON.stringify(evidence)).not.toMatch(POISON);
    expect(evidence.organizations).toEqual([]);
  });

  it("is idempotent through the dispatcher", () => {
    const observation = poisoned(capture(page(foreignLd + article())));
    const once = scopeProviderVacancyEvidence(observation);
    expect(scopeProviderVacancyEvidence(once)).toBe(once);
  });
});
