import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { assessBrowserVacancyCapture } from "../../src/application/acquisition/assessBrowserVacancyCapture.js";
import { ProviderCaptureRegistry } from "../../src/application/acquisition/ProviderCaptureRegistry.js";
import { locateGenericWorkdayContext, isGenericWorkdaySource } from "../../src/application/acquisition/GenericWorkdayVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { scopeWorkdayVacancyEvidence } from "../../src/application/evidence/scopeWorkdayVacancyEvidence.js";
import { scopeProviderVacancyEvidence } from "../../src/application/evidence/scopeProviderVacancyEvidence.js";
import { scopeKellyVacancyEvidence } from "../../src/application/evidence/scopeKellyVacancyEvidence.js";
import { scopeRenaultVacancyEvidence } from "../../src/application/evidence/scopeRenaultVacancyEvidence.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

const url = "https://example.wd5.myworkdayjobs.com/en-US/site/details/Engineer_JR-123";
const header = '<div data-automation-id="jobPostingHeader"><h1 data-automation-id="jobTitle">Software Engineer</h1><div data-automation-id="company">Trusted employer</div><div data-automation-id="locations">Rouen</div><div data-automation-id="timeType">Full time</div><div data-automation-id="requisitionId">JR-123</div></div>';
const foreign = '<script type="application/ld+json">{"@type":"JobPosting","title":"Poison title","hiringOrganization":{"name":"Poison company"},"jobLocation":{"address":{"addressLocality":"Poison city"}},"employmentType":"Poison contract"}</script>';
const extractor = createVacancyEvidenceExtractor();
function captured(html = header, pageUrl = url): SourceObservation {
  return new DeterministicAcquisitionCaptureMapper().toSourceObservation(
    new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl, pageTitle: "Poison title",
      visibleText: "Poison raw text", html, capturedAt: "2026-11-14T20:00:00Z" }, "a"), "o");
}
function legacy(html = header): SourceObservation {
  const original = captured(html);
  return { ...original, metadata: { acquisition: { html } } };
}
describe("generic Workday bounded evidence", () => {
  it("accepts the bounded header and preserves safe title, company, location, time type and ID", async () => {
    const input = captured();
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    expect(input).toMatchObject({ title: "Software Engineer", displayedCompanyName: "Trusted employer", locationText: "Rouen", contractText: "Full time" });
    expect(input.source.externalId).toBe("JR-123");
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toContainEqual(expect.objectContaining({ value: "Software Engineer" }));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Trusted employer" }));
    expect(evidence.locations).toContainEqual(expect.objectContaining({ value: "Rouen" }));
    expect(evidence.engagements).toContainEqual(expect.objectContaining({ normalizedTerms: ["FULL_TIME"] }));
  });
  it("does not resolve an employer from foreign JSON-LD during processing", async () => {
    const db = createDatabase(":memory:");
    try {
      const html = header.replace('<div data-automation-id="company">Trusted employer</div>', "") + foreign;
      const result = await createCaptureProcessingRuntime(db).captureAndProcessBrowserVacancy({
        pageUrl: url, pageTitle: "Poison title", visibleText: "Employeur: Poison company",
        html, capturedAt: "2026-11-14T20:00:00Z",
      });
      if (result.processing.status !== "PROCESSED") throw Error("Expected accepted capture");
      const vacancy = (await new SqliteCanonicalVacancyRepository(db).findById(result.processing.canonicalVacancyId))!;
      expect(vacancy.organizationRelationships.every(item => item.rawName === undefined)).toBe(true);
      expect((await extractor.extract(captured(html))).organizations).toEqual([]);
    } finally { db.close(); }
  });
  it.each([1, 2])("excludes %i foreign JSON-LD records, including legacy captures", async count => {
    for (const input of [captured(header + foreign.repeat(count)), legacy(header + foreign.repeat(count))]) {
      expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
      expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
      expect(JSON.stringify(scopeWorkdayVacancyEvidence(input))).not.toContain("Poison");
    }
  });
  it.each(["title", "displayedCompanyName", "locationText", "contractText", "salaryText", "description", "rawContent", "contactText"] as const)(
    "ignores page-level %s", async field => {
      const input = { ...legacy(), [field]: "Poison company Employeur: Poison company CDI Paris" };
      expect(JSON.stringify(scopeWorkdayVacancyEvidence(input))).not.toContain("Poison");
      expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
    });
  it("excludes structuredPayload from the evidence view", async () => {
    const input = { ...legacy(), metadata: { acquisition: { html: header, structuredPayload: {
      format: "SCHEMA_ORG_JOB_POSTING_JSON_LD", jobPostings: [{ "@type": "JobPosting", hiringOrganization: { name: "Poison employer" } }],
    } } } };
    expect(JSON.stringify(scopeWorkdayVacancyEvidence(input))).not.toContain("Poison");
    expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
  });
  it("ignores page-global title/company/location/timeType and neighboring employer or description", async () => {
    const input = legacy('<header data-automation-id="headerTitle">Poison careers</header>' + header
      + '<div data-automation-id="jobTitle">Poison title</div><div data-automation-id="company">Poison company</div>'
      + '<div data-automation-id="subtitle">Poison city</div><div data-automation-id="timeType">Poison contract</div>'
      + '<div data-automation-id="jobPostingDescription">Employeur: Poison employer</div><aside>Employeur: Poison neighbor</aside>');
    expect(JSON.stringify(await extractor.extract(input))).not.toContain("Poison");
    expect(JSON.stringify(scopeWorkdayVacancyEvidence(input))).not.toContain("Poison");
  });
  it.each([
    ["duplicate headers", header + header],
    ["hidden header", header.replace('data-automation-id="jobPostingHeader"', 'hidden data-automation-id="jobPostingHeader"')],
    ["aria-hidden header", header.replace('data-automation-id="jobPostingHeader"', 'aria-hidden="true" data-automation-id="jobPostingHeader"')],
    ["hidden ancestor", '<section hidden>' + header + '</section>'],
    ["conflicting requisitions", header + '<div data-automation-id="requisitionId">JR-999</div>'],
    ["second subtitle requisition", header + '<div data-automation-id="subtitle">Other job JR-999</div>'],
    ["duplicate same requisition", header + '<div data-automation-id="requisitionId">JR-123</div>'],
    ["duplicate titles", header.replace("</h1>", '</h1><h1 data-automation-id="jobTitle">Other engineer</h1>')],
    ["competing detail regions", header + '<section data-automation-id="jobDetails"></section><section data-automation-id="jobDetails"></section>'],
    ["competing descriptions", header + '<div data-automation-id="jobPostingDescription">First</div><div data-automation-id="jobPostingDescription">Other</div>'],
    ["unrelated job region", header + '<aside><h2 data-automation-id="jobPostingHeader">Poison engineer</h2><div data-automation-id="subtitle">Poison JR-999</div></aside>'],
    ["meaningless title", header.replace("Software Engineer", "Search jobs")],
  ])("fails closed for %s", async (_name, html) => {
    const input = legacy(html + foreign);
    const acceptance = await assessBrowserVacancyCapture(input, extractor);
    expect(acceptance).toMatchObject({ captureAcceptedAsVacancy: false });
    expect(acceptance).not.toHaveProperty("partialRecaptureIdentity");
    const evidence = await extractor.extract(input);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
  });
  const bareHeader = '<h2 data-automation-id="jobPostingHeader">Software Engineer</h2>';
  const reference = '<ul data-automation-id="subtitle"><li>Rouen; Paris</li><li>JR-123</li></ul>';
  it("supports only the immediately adjacent matching subtitle, retaining multiple locations", async () => {
    const input = legacy(bareHeader + reference + '<div data-automation-id="timeType">Poison contract</div>');
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: true });
    const evidence = await extractor.extract(input);
    expect(evidence.locations.map(item => item.value)).toEqual(["Rouen", "Paris"]);
    expect(evidence.engagements).toEqual([]);
  });
  it.each([
    bareHeader + '<div data-automation-id="timeType">Full time</div>' + reference,
    '<section>' + bareHeader + '</section>' + reference,
    bareHeader + '<aside>' + reference + '</aside>',
  ])("rejects an unowned reference separated from the header", async html => {
    expect(await assessBrowserVacancyCapture(legacy(html), extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  });
  it.each([
    { externalId: "JR-999" }, { sourceUrl: url.replace("JR-123", "JR-999") },
    { sourceUrl: url.replace("example.", "other.") }, { sourceUrl: url.replace("/details/", "/job/") },
    { sourceUrl: url.replace("https:", "ftp:") },
  ])("rejects source/route disagreement %j", async override => {
    const input = legacy();
    const mismatched = { ...input, source: { ...input.source, ...override } };
    expect((await extractor.extract(mismatched)).vacancyTitles).toEqual([]);
    expect(await assessBrowserVacancyCapture(mismatched, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  });
  const context = () => locateGenericWorkdayContext({ sourceName: new URL(url).hostname, sourceUrl: url, html: header })!;
  it("reuses trusted stored contexts, reconstructs legacy captures and is idempotent", () => {
    const stored = context();
    const scoped = scopeWorkdayVacancyEvidence({ ...legacy(), metadata: { acquisition: { contexts: [stored] } } });
    expect("evidenceContent" in scoped && scoped.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" && scoped.evidenceContent.context).toBe(stored);
    expect(scopeWorkdayVacancyEvidence(scoped)).toEqual(scoped);
    expect(scopeWorkdayVacancyEvidence(legacy()).title).toBe("Software Engineer");
  });
  it.each([
    { providerExternalId: "JR-999" }, { providerKey: "KELLY_WORKDAY" }, { text: "Poison" },
    { html: header + foreign }, { associationMethod: "USER_SELECTED" }, { metadata: {} },
  ])("rejects untrusted stored context rather than replacing it %j", async override => {
    const input = { ...legacy(), metadata: { acquisition: { html: header, contexts: [{ ...context(), ...override }] } } };
    expect((await extractor.extract(input)).vacancyTitles).toEqual([]);
    expect(await assessBrowserVacancyCapture(input, extractor)).toMatchObject({ captureAcceptedAsVacancy: false });
  });
  it("rejects multiple stored contexts", async () => {
    const input = { ...legacy(), metadata: { acquisition: { html: header, contexts: [context(), context()] } } };
    expect((await extractor.extract(input)).vacancyTitles).toEqual([]);
  });
  it.each([
    ["Kelly", "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Supervisor-Site_JR100451", "kellyWorkdaySelectedVacancy.html", scopeKellyVacancyEvidence, "KELLY_WORKDAY"],
    ["Renault", "https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/job/Aubevoye/CS27---BAC-5---Stage-ingnieur-digitalisation-mtier-synthse-prestation-vhicules-H-F_JOBREQ_50273077/", "renaultWorkdaySelectedVacancy.html", scopeRenaultVacancyEvidence, "RENAULT_WORKDAY"],
  ] as const)("keeps %s on its specialized route", (_name, pageUrl, fixture, specializedScope, key) => {
    const html = readFileSync("tests/fixtures/" + fixture, "utf8");
    const input = captured(html, pageUrl);
    expect(isGenericWorkdaySource(input.source.sourceName, pageUrl)).toBe(false);
    expect(new ProviderCaptureRegistry().capture({ sourceName: input.source.sourceName, sourceUrl: pageUrl, html }).providerKey).toBe(key);
    expect(scopeWorkdayVacancyEvidence(input)).toBe(input);
    const scoped = scopeProviderVacancyEvidence(input);
    expect(scoped).toEqual(specializedScope(input));
    expect("evidenceContent" in scoped && scoped.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" && scoped.evidenceContent.context.providerKey).toBe(key);
  });
});

