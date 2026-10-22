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
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { readFileSync } from "node:fs";
const manpowerId = "412687";
const manpowerUrl = "https://www.manpower.com/en/job/architecture-and-engineering/failure-analysis-engineer-/412687";
const pane = readFileSync("tests/fixtures/manpowerDirectVacancy.html", "utf8");
const wholeDollarPane = readFileSync("tests/fixtures/manpowerWholeDollarVacancy.html", "utf8");
const outside = '<nav>Other title H/F, Paris, 100000 EUR / YEAR, CDI</nav><footer>Footer Company recrute</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = manpowerUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Manpower | US",
    visibleText: "Other title H/F, Paris, 100000 EUR / YEAR, CDI", capturedAt: "2026-10-22T12:00:00Z" }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(html = page(), pageUrl = manpowerUrl) {
  const { observation } = capture(html, pageUrl);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-22") },
  });
  return { evidence, canonical };
}
describe("Manpower direct vacancy", () => {
  it("recognizes provider, direct route and consistent reference", () => {
    const { acquisition, observation } = capture();
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "MANPOWER", providerExternalId: manpowerId });
    expect(observation.source).toMatchObject({ sourceName: "manpower.com", externalId: manpowerId });
    expect(acquisition.contexts?.[0]?.text).not.toMatch(/Other title|100000|Footer Company|SEARCH JOBS/);
    expect(observation.metadata.acquisition).toMatchObject({ html: page() });
  });
  it("uses header title over secondary description title and resolves workplace", async () => {
    const { canonical } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Failure Analysis Engineer" } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Los Angeles, CA" } });
  });
  it("maps Temporary and Full Time independently", async () => {
    expect((await project()).canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM", "FULL_TIME"]);
    expect((await project(page(pane.replace("Full Time", "Unspecified")))).canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM"]);
  });
  it("preserves USD 32 without manufacturing a maximum or period", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.compensations).toContainEqual(expect.objectContaining({ rawText: "$32", currency: "USD", minimum: 32 }));
    expect(canonical.compensation.value).toMatchObject({ currency: "USD", minimum: 32 });
    expect(canonical.compensation.value?.period).toBeUndefined();
    expect(canonical.compensation.value?.maximum).toBeUndefined();
  });
  it.each(["$32", "$32.00", "$38.33"])("extracts %s from a standalone pay paragraph", async salary => {
    const { evidence, canonical } = await project(page(pane.replace("$32", salary)));
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: salary, currency: "USD", minimum: Number(salary.slice(1)) })]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: salary, currency: "USD", minimum: Number(salary.slice(1)) } });
    expect(canonical.compensation.value).not.toHaveProperty("maximum");
    expect(canonical.compensation.value).not.toHaveProperty("period");
  });
  it.each(["$32", "$32.00", "$38.33"])("extracts %s after other labeled facts in one paragraph", async salary => {
    const html = page(pane.replace('<p><strong>Pay Range:</strong>$32</p>', `<p><strong>Job Title:</strong> Secondary title<br><strong>Location:</strong> Los Angeles<br><strong>Pay Range: </strong>${salary}</p>`));
    const { evidence, canonical } = await project(html);
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: salary, currency: "USD", minimum: Number(salary.slice(1)) })]);
    expect(canonical.compensation.value).toEqual({ rawText: salary, currency: "USD", minimum: Number(salary.slice(1)) });
  });
  it.each(["<br/>", "<br />", "<BR>"])("handles explicit HTML break variant %s", async lineBreak => {
    const html = page(pane.replace('<p><strong>Pay Range:</strong>$32</p>', `<p>Location: Los Angeles${lineBreak}<strong>Pay Range:</strong>$32.00${lineBreak}Weekly Pay</p>`));
    expect((await project(html)).canonical.compensation.value).toEqual({ rawText: "$32.00", currency: "USD", minimum: 32 });
  });
  it("fails closed on multiple pay labels within a shared paragraph", async () => {
    const html = page(pane.replace('<p><strong>Pay Range:</strong>$32</p>', '<p>Pay Range: $32.00<br>Pay Range: $38.33</p>'));
    expect(capture(html).acquisition.contexts).toBeUndefined();
    expect((await project(html)).evidence.compensations).toEqual([]);
  });
  it("extracts the saved 412512 regression without changing identity or employer semantics", async () => {
    const url = "https://www.manpower.com/en/job/architecture-and-engineering/readiness-and-response-operator-2/412512";
    const { acquisition } = capture(page(wholeDollarPane), url);
    expect(acquisition.externalId).toBe("412512");
    expect(acquisition.contexts?.[0]?.providerExternalId).toBe("412512");
    const { evidence, canonical } = await project(page(wholeDollarPane), url);
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "$32.00", currency: "USD", minimum: 32 })]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: "$32.00", currency: "USD", minimum: 32 } });
    expect(canonical.compensation.value).not.toHaveProperty("maximum");
    expect(canonical.compensation.value).not.toHaveProperty("period");
    expect(canonical.organizationRelationships.some(r => r.role === "EMPLOYER" || r.role === "CLIENT")).toBe(false);
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "RECRUITER", rawName: "Manpower Engineering" }));
  });
  it.each(["$32.0.0", "$32.000", "$32 dollars extra", "$1,250.00"])("rejects malformed or unsupported numeric grammar: %s", async salary => {
    const { evidence, canonical } = await project(page(pane.replace("$32", salary)));
    expect(evidence.compensations).toEqual([]);
    expect(canonical.compensation.status).toBe("UNKNOWN");
  });
  it("accepts an explicitly attached pay period", async () => {
    expect((await project(page(pane.replace("$32", "$32 per hour")))).evidence.compensations[0]?.period).toBe("HOUR");
  });
  it("projects explicit industry and preserves publication date", async () => {
    expect(capture().observation.publishedAt).toEqual(new Date("2026-10-21T13:57:21.000Z"));
    expect((await project()).canonical.industryContexts.value).toEqual(["Architecture and Engineering"]);
  });
  it("keeps agency, recruiter person and anonymous client separate", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Manpower Engineering", role: "RECRUITMENT_AGENCY" })]);
    expect(evidence.people).toContainEqual(expect.objectContaining({ value: "Luisa Bardalez", role: "RECRUITER" }));
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ rawName: "Manpower Engineering", role: "RECRUITER" }));
    expect(canonical.organizationRelationships.some(r => r.role === "EMPLOYER" || r.role === "CLIENT")).toBe(false);
    expect(capture().acquisition.contexts?.[0]?.text).toContain("luisa.bardalez@manpowergroup.com");
  });
  it.each([pane.replace('alt="Manpower Engineering"', 'alt=""'), pane.replace("Our client,", "This role,")])("requires explicit branding and client wording for agency semantics", async job => {
    expect((await project(page(job))).evidence.organizations).toEqual([]);
  });
  it.each([
    pane.replace("<span>412687</span>", "<span>999999</span>"),
    pane.replace('<main id="main"', '<main data-job-id="999999" id="main"'),
    pane.replace('</article>', '<div class="job-card">Other role H/F</div></article>'),
    pane.replace('</article>', '<h1>Other role</h1></article>'),
    pane.replace('/failure-analysis-engineer-/412687"', '/failure-analysis-engineer-/999999"'),
    "", pane + pane, pane.replace("details-rich-text", "unknown-description"), pane.replace("article-header-container", "unknown-header"),
    pane.replace("location-sidebar", "unknown-location"), pane.replace("</main>", '<input value="Search"></main>'),
  ])("fails closed on identity conflicts, missing regions and ambiguous layouts", async job => {
    const { acquisition, observation } = capture(page(job));
    expect(acquisition.externalId).toBe(manpowerId);
    expect(acquisition.contexts).toBeUndefined();
    const evidence = await extractor.extract({ ...observation, title: "Unsafe role H/F", displayedCompanyName: "Unsafe Agency", salaryText: "100000 EUR / YEAR", locationText: "Paris", contractText: "CDI" });
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.organizations).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.engagements).toEqual([]);
  });
  it.each(["https://www.manpower.com/en/search", "https://evil.example/en/job/category/title/412687", "https://www.manpower.com/en/job/category/title/not-a-number"])("does not promote unsupported routes or hosts", url => {
    expect(capture(page(), url).acquisition.contexts).toBeUndefined();
    expect(capture(page(), url).acquisition.externalId).toBeUndefined();
  });
  it("does not trust page-level structured data outside verified boundaries", async () => {
    const html = page("") + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"412687","title":"Other role H/F"}</script>';
    expect(capture(html).acquisition.content.structuredPayload).toBeUndefined();
    expect((await project(html)).evidence.vacancyTitles).toEqual([]);
  });
  it("excludes unrelated siblings inside main as well as outer page chrome", async () => {
    const html = page(pane.replace('</main>', '<section>Other title H/F, Paris, 100000 EUR / YEAR</section></main>'));
    expect(capture(html).acquisition.contexts?.[0]?.text).not.toMatch(/Other title|100000/);
    expect((await project(html)).canonical.compensation.value?.minimum).toBe(32);
  });
  it("reprocesses old immutable ID-less source without modifying it", async () => {
    const observation = capture().observation;
    const { externalId: _, ...source } = observation.source;
    const old = { ...observation, source };
    const before = structuredClone(old);
    expect((await extractor.extract(old)).vacancyTitles[0]?.value).toBe("Failure Analysis Engineer");
    expect(old).toEqual(before);
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: manpowerUrl, pageTitle: "Manpower", html: page(), visibleText: "Manpower vacancy", capturedAt: "2026-10-22T12:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      const original = await deps.sourceObservationRepository.findById(first.capture.observationId);
      const assignments = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      for (const capturedAt of ["2026-10-22T12:01:00Z", "2026-10-22T12:02:00Z"]) {
        const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt });
        expect(repeated.capture.observationId).toBe(first.capture.observationId);
        expect(repeated.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      }
      expect(await deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(assignments);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("troubleshooting", "diagnostics")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("Manpower Engineering");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: manpowerUrl.replace(manpowerId, "412688"), html: page().replaceAll(manpowerId, "412688"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
