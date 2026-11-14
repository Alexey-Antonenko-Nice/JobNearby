import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { PersonioSelectedVacancyContextLocator } from "../../src/application/acquisition/PersonioVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopePersonioVacancyEvidence } from "../../src/application/evidence/scopePersonioVacancyEvidence.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

const url = "https://acme.jobs.personio.de/job/123";
const header = '<div class="job-header"><h1 class="job-position-title">Software Engineer</h1><span class="JobAttributes_jobMetaText__x">Full-time</span><span class="JobAttributes_jobMetaText__x">Permanent employee</span><span class="JobAttributes_jobMetaText__x">55,356 EUR per year</span></div>';
const foreign = '<script type="application/ld+json">{"@type":"JobPosting","title":"Poison title","hiringOrganization":{"name":"Poison company"},"jobLocation":{"address":{"addressLocality":"Poison city"}},"employmentType":"Poison contract"}</script>';
const extractor = createVacancyEvidenceExtractor();
function observation(html = header): SourceObservation {
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(
    new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: url, pageTitle: "Poison page title",
      visibleText: "Poison raw", html, capturedAt: "2026-11-14T07:00:00Z" }, "a"), "o");
}
function legacy(html = header): SourceObservation {
  const original = observation(html);
  return { ...original, metadata: { acquisition: { html } } };
}
describe("Personio bounded evidence", () => {
  it("accepts and preserves supported header facts and URL identity", async () => {
    const input = observation();
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toContainEqual(expect.objectContaining({ value: "Software Engineer" }));
    expect(evidence.compensations).toContainEqual(expect.objectContaining({ minimum: 55356, currency: "EUR" }));
    expect(evidence.engagements).toContainEqual(expect.objectContaining({ normalizedTerms: ["FULL_TIME", "INDEFINITE"] }));
    expect(input.source.externalId).toBe("123");
    expect(evidence.organizations).toEqual([]);
  });
  it.each([1, 2])("excludes %i foreign page-level JobPostings at acquisition and extraction", async count => {
    const input = observation(header + foreign.repeat(count));
    expect(input.displayedCompanyName).toBeUndefined();
    expect(input.locationText).toBeUndefined();
    expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
  });
  it.each(["title", "displayedCompanyName", "locationText", "contractText", "salaryText", "description", "rawContent", "contactText"] as const)(
    "ignores page-level %s", async field => {
      const input = { ...legacy(), [field]: "Poison company Employeur: Poison company CDI Paris" };
      const scoped = scopePersonioVacancyEvidence(input);
      expect(JSON.stringify(scoped)).not.toContain("Poison");
      expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
    });
  it("excludes structuredPayload poison, including employer evidence", async () => {
    const input = { ...legacy(), metadata: { acquisition: { html: header, structuredPayload: {
      format: "SCHEMA_ORG_JOB_POSTING_JSON_LD", jobPostings: [{ "@type": "JobPosting", title: "Poison title", hiringOrganization: { name: "Poison company" } }],
    } } } };
    const scoped = scopePersonioVacancyEvidence(input);
    expect(JSON.stringify(scoped)).not.toContain("Poison");
    expect((await extractor.extract(input)).organizations).toEqual([]);
  });
  it("excludes neighbors, footer, contact and detail text outside the header", async () => {
    const input = legacy(header + '<div class="detail-content">Employeur: Poison company CDI Paris</div><aside>Employeur: Poison neighbor</aside><footer>Poison footer</footer>');
    expect(JSON.stringify(scopePersonioVacancyEvidence(input))).not.toContain("Poison");
    expect((await extractor.extract(input)).organizations).toEqual([]);
  });
  it.each([
    ["duplicate headers", header + header],
    ["duplicate titles", header.replace("</h1>", '</h1><h1 class="job-position-title">Second engineer</h1>')],
    ["hidden header", header.replace('class="job-header"', 'class="job-header" hidden')],
    ["aria-hidden header", header.replace('class="job-header"', 'class="job-header" aria-hidden="true"')],
    ["hidden ancestor", '<section hidden>' + header + '</section>'],
    ["hidden title", header.replace('class="job-position-title"', 'class="job-position-title" style="display:none"')],
    ["meaningless title", header.replace("Software Engineer", "Jobs")],
    ["unsupported header tag", header.replaceAll("div", "section")],
  ])("fails closed for %s", async (_name, html) => {
    const input = legacy(html + foreign);
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.compensations).toEqual([]);
  });
  it.each([
    { externalId: "999" }, { sourceUrl: url + "/apply" },
    { sourceUrl: url.replace("acme.", "other.") },
  ])("rejects source/route identity mismatch %j", async override => {
    const input = legacy();
    const mismatched = { ...input, source: { ...input.source, ...override } };
    expect((await extractor.extract(mismatched)).vacancyTitles).toEqual([]);
    expect(await assessBrowserVacancyCapture(mismatched, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  });
  const context = () => new PersonioSelectedVacancyContextLocator().locate({ providerKey: "PERSONIO", sourceUrl: url, html: header })!;
  it("reuses validated stored context and supports legacy HTML without context", () => {
    const stored = context();
    const original = legacy();
    const input = { ...original, metadata: { acquisition: { contexts: [stored] } } };
    const scoped = scopePersonioVacancyEvidence(input);
    expect("evidenceContent" in scoped && scoped.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" && scoped.evidenceContent.context).toBe(stored);
    expect(scopePersonioVacancyEvidence(original).title).toBe("Software Engineer");
    expect(scopePersonioVacancyEvidence(scoped)).toEqual(scoped);
  });
  it.each([
    { providerKey: "LINKEDIN" }, { providerExternalId: "999" }, { text: "Poison text" },
    { html: header + foreign }, { associationMethod: "USER_SELECTED" },
  ])("fails closed on untrusted stored context %j without replacing it", async override => {
    const input = { ...legacy(), metadata: { acquisition: { html: header, contexts: [{ ...context(), ...override }] } } };
    expect((await extractor.extract(input)).vacancyTitles).toEqual([]);
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  });
  it("rejects competing stored contexts", async () => {
    const input = { ...legacy(), metadata: { acquisition: { html: header, contexts: [context(), context()] } } };
    expect((await extractor.extract(input)).vacancyTitles).toEqual([]);
  });
});

