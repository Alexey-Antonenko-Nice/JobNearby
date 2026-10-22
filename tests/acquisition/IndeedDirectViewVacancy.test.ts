import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const id = "c490a2e96ac87591";
const url = `https://fr.indeed.com/viewjob?jk=${id}`;
const title = "Technicien de maintenance industrielle 5X8 H/F";
const company = "Le Recrutement Industriel";
const salary = "De 36 000 € à 42 000 € par an";
// Minimized from the live standalone direct page: no ViewjobPaneWrapper,
// and the search form is inside viewjob-main-content alongside the job.
const header = `<div data-testid="desktop-job-header"><h5 data-testid="vj-job-title">${title}</h5>
  <div data-testid="company-info-metadata"><a href="/cmp/Le-Recrutement-Industriel?fromjk=${id}">${company}</a><div>Strasbourg (67)</div></div>
  <div>${salary}</div><a href="/viewjob?jk=${id}">Postuler maintenant</a></div>`;
const content = `<div data-testid="viewjob-job-content"><div data-testid="structured-job-summary"><div>${salary}</div><div>CDI</div><div>Temps plein</div></div>
  <h4 data-testid="vj-job-description-heading">Description du poste</h4><p>Notre cabinet de recrutement recherche pour l’un de ses clients un technicien.</p>
  <p>Maintenance préventive et corrective des équipements de production.</p></div>`;
const outside = `<aside><p>Autre emploi H/F</p><p>Other Company</p><p>80 000 - 90 000 € / an</p>
  <p>Expérience de 10 à 15 ans</p><p>maîtrise de l'allemand</p><p>déplacements réguliers</p><p>Temps partiel</p></aside>`;
function page(head = header, body = content) {
  return `<nav>Paris Search Company</nav><div data-testid="viewjob-main-content">
    <div data-testid="standalone-desktop-search-page">Paris Search Company 200 000 € / an</div>
    ${head}${body}${outside}<footer>Footer Company</footer></div>${outside}`;
}
function capture(html = page(), pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl, html, pageTitle: "Indeed",
    visibleText: `Paris Search Company\n${title}\n${company}\n${salary}\nOther Company\n80 000 - 90 000 € / an`, capturedAt: "2026-10-22T06:00:00Z" }, "capture");
  const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
  return { acquisition, observation };
}
const extractor = createVacancyEvidenceExtractor();
async function projection(html = page()) {
  const { observation } = capture(html);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
    derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-22") },
  });
  return { canonical, evidence };
}

describe("Indeed standalone direct vacancy isolation", () => {
  it.each([url, `${url}&from=alert&utm_source=test`])("captures direct URL identity and a bounded context: %s", (pageUrl) => {
    const { acquisition, observation } = capture(page(), pageUrl);
    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]).toMatchObject({ providerKey: "INDEED", providerExternalId: id });
    expect(acquisition.contexts![0]!.text).toContain("Maintenance préventive");
    expect(acquisition.contexts![0]!.text).not.toMatch(/Paris|Search Company|Other Company|80 000|Footer Company/);
    expect(observation.metadata.acquisition).toMatchObject({ html: page() });
  });
  it("projects title, company and location exclusively from the direct job", async () => {
    const { canonical, evidence } = await projection();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Strasbourg (67)" } });
    expect(canonical.organizationRelationships).toEqual([expect.objectContaining({ role: "DISPLAYED_COMPANY", rawName: company })]);
    expect(JSON.stringify(evidence)).not.toMatch(/Paris|Other Company|Autre emploi|80 000|allemand|15 ans/);
    expect(evidence.experienceRequirements).toEqual([]);
    expect(evidence.languageRequirements).toEqual([]);
    expect(evidence.travelRequirements).toEqual([]);
  });
  it("resolves annual compensation, CDI and explicitly stated full-time", async () => {
    const { canonical } = await projection();
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: salary, currency: "EUR", minimum: 36000, maximum: 42000, period: "YEAR" } });
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(canonical.canonicalizationStatus).toBe("USABLE");
  });
  it("does not infer full-time from CDI", async () => {
    expect((await projection(page(header, content.replace("Temps plein", "")))).canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("uses the explicit URL key when the bounded DOM has no independent identifier", () => {
    const withoutIds = header.replace(/\?fromjk=[^"']+|\?jk=[^"']+/gu, "");
    expect(capture(page(withoutIds)).acquisition.contexts).toHaveLength(1);
  });
  it.each([
    header.replace(`fromjk=${id}`, "fromjk=other"),
    header.replace(`jk=${id}">Postuler`, "jk=other\">Postuler"),
    header.replace('<div data-testid="desktop-job-header">', '<div data-testid="desktop-job-header" data-job-key="other">'),
  ])("fails closed for conflicting direct DOM identity", async (head) => {
    const { acquisition, observation } = capture(page(head));
    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it("checks identity attributes on the enclosing direct container", () => {
    expect(capture(page().replace('data-testid="viewjob-main-content"', 'data-testid="viewjob-main-content" data-jk="other"')).acquisition.contexts).toBeUndefined();
  });
  it.each([
    outside,
    page().replace('data-testid="viewjob-main-content"', 'data-testid="unsupported-main"'),
    page() + page(),
    page(header, ""),
    page(header + header),
    page(header, content.replace('</p>', `${outside}</p>`)),
    page(header, content.replace("Maintenance préventive", '<div class="result job_other">Other job</div>Maintenance préventive')),
  ])("fails closed for unsupported, ambiguous, or contaminated job bounds", async (html) => {
    const { acquisition, observation } = capture(html);
    expect(acquisition.externalId).toBe(id);
    expect(acquisition.contexts).toBeUndefined();
    const evidence = await extractor.extract({ ...observation, title: "Untrusted H/F", displayedCompanyName: "Other Company", salaryText: "80000 EUR / YEAR", contractText: "PART_TIME" });
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(evidence.locations).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    expect(evidence.engagements).toEqual([]);
  });
  it.each([page(), outside])("does not let page-level JSON-LD bypass direct vacancy checks", async (html) => {
    const posting = { "@type": "JobPosting", title: "Poisoned role H/F", url: `${url}&jk=other`, hiringOrganization: { name: "Poisoned Company" } };
    const { acquisition, observation } = capture(`${html}<script type="application/ld+json">${JSON.stringify([posting, posting])}</script>`);
    expect(acquisition.content.structuredPayload).toBeUndefined();
    expect(JSON.stringify(await extractor.extract(observation))).not.toContain("Poisoned");
  });
  it("re-extracts the stored failed direct capture without mutating it", async () => {
    const old = { ...capture().observation, metadata: { acquisition: { html: page() } } };
    const before = structuredClone(old);
    expect((await extractor.extract(old)).vacancyTitles).toContainEqual(expect.objectContaining({ value: title }));
    expect(old).toEqual(before);
  });
  it("preserves fallback semantics, exact recaptures, changed snapshots, and employer continuity", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const sources = new SqliteSourceObservationRepository(db);
      const canonicals = new SqliteCanonicalVacancyRepository(db);
      const payload = { pageUrl: url, pageTitle: "Indeed", visibleText: title, capturedAt: "2026-10-22T06:00:00Z" };
      const failed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: outside });
      if (failed.processing.status !== "PROCESSED") throw Error("Processing failed");
      const canonicalId = failed.processing.canonicalVacancyId;
      expect((await canonicals.findById(canonicalId))?.role.status).toBe("UNKNOWN");
      expect(db.prepare("SELECT status, algorithm FROM observation_cluster_assignments").all()).toEqual([{ status: "ACCEPTED", algorithm: "new-employer-cluster" }]);
      const original = await sources.findById(failed.capture.observationId);
      const clean = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(), capturedAt: "2026-10-22T06:01:00Z" });
      expect(clean.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      const assignments = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const firstProjection = (await canonicals.findById(canonicalId))!;
      for (const capturedAt of ["2026-10-22T06:02:00Z", "2026-10-22T06:03:00Z"]) {
        const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: `${url}&utm_source=repeat`, html: page(), capturedAt });
        expect(repeated.capture.observationId).toBe(clean.capture.observationId);
        expect(repeated.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      }
      expect(await sources.countCaptureOccurrences([clean.capture.observationId])).toBe(3);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(assignments);
      const repeatedProjection = (await canonicals.findById(canonicalId))!;
      expect(repeatedProjection.organizationRelationships.map(({ derivation: _, ...value }) => value)).toEqual(firstProjection.organizationRelationships.map(({ derivation: _, ...value }) => value));
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(header, content.replace("Maintenance préventive", "Maintenance préventive et dépannage")), capturedAt: "2026-10-22T06:04:00Z" });
      expect(changed.capture.observationId).not.toBe(clean.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 3 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(DISTINCT employer_cluster_id) AS count FROM observation_cluster_assignments").get()).toEqual({ count: 1 });
      expect(await sources.findById(failed.capture.observationId)).toEqual(original);
      expect((await canonicals.findById(canonicalId))?.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 36000, maximum: 42000, period: "YEAR" } });
    } finally { db.close(); }
  });
});
