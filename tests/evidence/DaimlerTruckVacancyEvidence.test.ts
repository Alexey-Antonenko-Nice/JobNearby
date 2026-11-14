import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { trustedDaimlerJobPosting } from "../../src/application/acquisition/DaimlerTruckVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { DirectFieldVacancyEvidenceExtractor } from "../../src/application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { directEmployerOrganizationNames } from "../../src/application/evidence/TrustedDirectEmployerSource.js";
import { scopeDaimlerTruckVacancyEvidence } from "../../src/application/evidence/scopeDaimlerTruckVacancyEvidence.js";
import { hasExplicitVacancyEvidenceScopeRoute } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import { ProviderCaptureRegistry } from "../../src/application/acquisition/ProviderCaptureRegistry.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

const url = "https://jobsearch.daimlertruck.com/index.php?ac=jobad&id=425255";
const posting = { "@type": "JobPosting", title: "Software Engineer",
  hiringOrganization: { name: "Trusted employer" }, jobLocation: { address: { addressLocality: "Molsheim" } },
  employmentType: "Full time", baseSalary: { currency: "EUR", value: 45000 }, datePosted: "2026-11-01" };
const script = (value: unknown) => '<script type="application/ld+json">' + JSON.stringify(value) + '</script>';
function observation(html = script(posting), pageUrl = url): SourceObservation {
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(
    new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl, html, pageTitle: "Poison title",
      visibleText: "Employeur: Poison company\nPoison location", capturedAt: "2026-11-14T20:00:00Z" }, "a"), "o");
}
function legacy(html = script(posting)): SourceObservation {
  const input = observation(html);
  return { ...input, title: "Poison title", displayedCompanyName: "Poison company", locationText: "Poison location",
    contractText: "Poison contract", contactText: "Employeur: Poison contact", description: "Employeur: Poison description",
    metadata: { acquisition: { html, structuredPayload: { jobPostings: [{ ...posting, hiringOrganization: { name: "Poison payload" } }] } } } };
}
const extractor = createVacancyEvidenceExtractor();
describe("Daimler single JobPosting guard", () => {
  it.each([
    {},
    { url }, { url: url + "&utm_source=test#details" },
  ])("accepts one posting with compatible identity %j", async identity => {
    const input = observation(script({ ...posting, ...identity }));
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(input).toMatchObject({ title: posting.title, displayedCompanyName: "Trusted employer", locationText: "Molsheim", contractText: "Full time" });
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toEqual([expect.objectContaining({ value: posting.title })]);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Trusted employer", role: "EMPLOYER" }));
    expect(evidence.engagements).toContainEqual(expect.objectContaining({ normalizedTerms: ["FULL_TIME"] }));
    expect(JSON.stringify(evidence)).not.toContain("Poison");
  });
  it.each([
    { identifier: "999" }, { identifier: { value: "999" } }, { url: url.replace("425255", "999") },
    { identifier: "425255", url: url.replace("425255", "999") },
    { identifier: "999", url },
    { identifier: null }, { identifier: { value: 425255 } }, { identifier: ["425255"] },
    { url: null }, { url: "https://foreign.example/index.php?ac=jobad&id=425255" },
    { url: "https://jobsearch.daimlertruck.com/other.php?ac=jobad&id=425255" },
    { url: url + "&id=999" },
    // A real secondary number without DOM/application corroboration is insufficient.
    { identifier: { "@type": "PropertyValue", name: "Mercedes-Benz Trucks Molsheim SASU", value: 10027 } },
  ])("fails closed on conflicting or unsupported structured identity %j", async identity => {
    const input = legacy(script({ ...posting, ...identity }));
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
    expect(directEmployerOrganizationNames(input)).toEqual([]);
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
    expect((await new DirectFieldVacancyEvidenceExtractor().extract(input)).organizations).toEqual([]);
  });
  it.each([
    ["zero", script({ "@type": "Organization", name: "Poison company" })],
    ["two array postings", script([posting, { ...posting, hiringOrganization: { name: "Poison second employer" } }])],
    ["two scripts", script(posting) + script({ ...posting, hiringOrganization: { name: "Poison second employer" } })],
    ["two graph postings", script({ "@graph": [posting, { ...posting, hiringOrganization: { name: "Poison second employer" } }] })],
  ])("rejects %s without vacancy or employer leakage", async (_label, html) => {
    const input = legacy(html);
    const acceptance = await assessBrowserVacancyCapture(input, extractor);
    expect(acceptance).toMatchObject({ captureAcceptedAsVacancy: false });
    expect(acceptance).not.toHaveProperty("partialRecaptureIdentity");
    expect(directEmployerOrganizationNames(input)).toEqual([]);
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
    const acquired = observation(html);
    expect(acquired.displayedCompanyName).toBeUndefined();
    expect(acquired.locationText).toBeUndefined();
  });
  it("blocks multi-posting direct employer evidence even without acceptance", () => {
    expect(directEmployerOrganizationNames(legacy(script([posting, { ...posting, hiringOrganization: { name: "Foreign employer" } }])))).toEqual([]);
  });
  it("excludes unrelated organizations and page fields while preserving only the trusted projection", async () => {
    const input = legacy(script({ "@graph": [posting, { "@type": "Organization", name: "Poison graph employer" }] })
      + '<aside>Employeur: Poison neighbor</aside><article itemscope itemtype="https://schema.org/JobPosting"><span itemprop="title">Poison microdata</span></article>');
    const before = structuredClone(input);
    const scoped = scopeDaimlerTruckVacancyEvidence(input);
    expect(scoped).toMatchObject({ title: posting.title, displayedCompanyName: "Trusted employer",
      locationText: "Molsheim", contractText: "Full time", salaryText: "45000 EUR", publishedAt: new Date("2026-11-01"), rawContent: "" });
    expect(JSON.stringify(scoped)).not.toContain("Poison");
    expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
    expect(directEmployerOrganizationNames(input)).toEqual(["Trusted employer"]);
    expect(scopeDaimlerTruckVacancyEvidence(scoped)).toEqual(scoped);
    expect(input).toEqual(before);
  });
  it("does not trust a payload-only posting without original HTML", async () => {
    const input = { ...legacy(), metadata: { acquisition: { structuredPayload: { jobPostings: [posting] } } } };
    expect(directEmployerOrganizationNames(input)).toEqual([]);
    expect((await extractor.extract(input)).organizations).toEqual([]);
  });
  it.each(["", "?id=425255", "?ac=search&id=425255", "?ac=jobad&id=425255&id=425255", "?ac=jobad&ac=jobad&id=425255"])(
    "rejects unsupported query %s", async query => {
      const input = observation(script(posting), "https://jobsearch.daimlertruck.com/index.php" + query);
      expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
      expect((await extractor.extract(input)).organizations).toEqual([]);
    });
  it.each(["999", undefined])("rejects missing or mismatched external ID %s", async externalId => {
    const input = legacy();
    const mismatched = { ...input, source: { sourceType: input.source.sourceType, sourceName: input.source.sourceName, sourceUrl: url, ...(externalId === undefined ? {} : { externalId }) } };
    expect(await assessBrowserVacancyCapture(mismatched, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
    expect(directEmployerOrganizationNames(mismatched)).toEqual([]);
  });
  it("preserves the existing route-only contract without inventing identity", () => {
    expect(trustedDaimlerJobPosting({ sourceName: "jobsearch.daimlertruck.com", sourceUrl: url, externalId: "425255", html: script(posting) })).toEqual(posting);
    expect(trustedDaimlerJobPosting({ sourceName: "jobsearch.daimlertruck.com", sourceUrl: url, externalId: "425255", html: script({ ...posting, title: "Jobs" }) })).toBeUndefined();
  });
  it("uses an explicit structured scope without requiring selected DOM context", () => {
    expect(hasExplicitVacancyEvidenceScopeRoute("jobsearch.daimlertruck.com", url)).toBe(true);
    expect(new ProviderCaptureRegistry().capture({ sourceName: "jobsearch.daimlertruck.com", sourceUrl: url }).requiresSelectedVacancyContext).toBeUndefined();
  });
  it("leaves non-Daimler direct-source behavior unchanged", () => {
    const base = legacy();
    const other = { ...base, source: { ...base.source, sourceName: "burkert.com", sourceUrl: "https://www.burkert.com/en/company-career/career/job-openings/engineer" } };
    expect(scopeDaimlerTruckVacancyEvidence(other)).toBe(other);
    expect(directEmployerOrganizationNames(other)).toEqual(["Poison company", "Poison payload"]);
    expect(directEmployerOrganizationNames({ ...other, source: { ...other.source, sourceName: "example.org", sourceUrl: "https://example.org/job" } })).toEqual([]);
  });
});

