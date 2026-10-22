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
const randstadId = "307-ust-r001990_01r";
const randstadUrl = "https://www.randstad.fr/emploi/technicien-de-preparation-de-matieres-premieres-fh_strasbourg_307-ust-r001990_01r/";
const pane = readFileSync("tests/fixtures/randstadDirectVacancy.html", "utf8");
const outside = '<nav>Other title H/F, Paris, 100000 EUR / YEAR, Temps plein</nav><footer>Footer Company recrute</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = randstadUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Randstad",
    visibleText: "Other title H/F, Paris, 100000 EUR / YEAR, Temps plein", capturedAt: "2026-10-22T12:00:00Z" }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(html = page()) {
  const { observation } = capture(html);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-22") },
  });
  return { evidence, canonical };
}
describe("Randstad direct vacancy", () => {
  it("recognizes provider, direct route and case-equivalent page reference while preserving URL reference", () => {
    const { acquisition, observation } = capture();
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "RANDSTAD", providerExternalId: randstadId });
    expect(observation.source).toMatchObject({ sourceName: "randstad.fr", externalId: randstadId });
    expect(acquisition.contexts?.[0]?.text).not.toMatch(/Other title|100000|Footer Company|accueil|partager cette offre|qualification/);
    expect(observation.metadata.acquisition).toMatchObject({ html: page() });
  });
  it("projects title/location, salary, contract, explicit hours and experience from normal bounded evidence", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "technicien de préparation de matières premières (f/h)." } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "strasbourg, bas-rhin" } });
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "strasbourg, bas-rhin" })]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: "29 000 € - 31 000 € par année", currency: "EUR", minimum: 29000, maximum: 31000, period: "YEAR" } });
    expect(evidence.compensations).toHaveLength(1);
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(evidence.engagements).toEqual([expect.objectContaining({ normalizedTerms: ["INDEFINITE"] }), expect.objectContaining({ rawTerms: ["JobPosting.employmentType=FULL_TIME"], normalizedTerms: ["FULL_TIME"] })]);
    expect(canonical.experienceRequirements.value).toEqual([{ rawText: "1 année(s)", minimumYears: 1, unit: "YEAR" }]);
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.compensations, ...evidence.engagements, ...evidence.experienceRequirements, ...evidence.organizations]) {
      expect(item.provenance).toMatchObject({ sourceObservationId: "observation", contentOrigin: "SELECTED_VACANCY_CONTEXT" });
    }
    for (const field of [canonical.role, canonical.location, canonical.compensation, canonical.engagement, canonical.experienceRequirements]) {
      const references = canonical.evidenceReferences.filter(r => field.supportingEvidenceIds.includes(r.id));
      expect(references.length).toBeGreaterThan(0);
      expect(references.every(r => r.kind !== "SOURCE_SALARY_TEXT" && r.kind !== "SOURCE_CONTRACT_TEXT")).toBe(true);
    }
  });
  it("preserves BAC+2 in bounded source without inventing an education taxonomy", async () => {
    expect(capture().acquisition.contexts?.[0]?.text).toContain("BAC+2");
    expect((await project()).canonical.educationRequirements.status).toBe("UNKNOWN");
  });
  it("uses the existing publication source field from the uniquely matched posting", () => {
    expect(capture().observation.publishedAt).toEqual(new Date("2026-09-24T10:06:09Z"));
  });
  it.each([
    pane.replace(/<script\b[\s\S]*?<\/script>/gu, ""),
    pane.replace('"employmentType":"FULL_TIME"', '"employmentType":"UNSPECIFIED"'),
  ])("does not manufacture full time from CDI or unrelated page chrome", async html => {
    const { canonical, evidence } = await project(page(html));
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INDEFINITE"]);
  });
  it("keeps Randstad France as displayed staffing agency with an unnamed employer", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Randstad France", role: "DISPLAYED_COMPANY" }), expect.objectContaining({ value: "Randstad France", role: "STAFFING_AGENCY" })]);
    expect(canonical.organizationRelationships.some(r => r.role === "EMPLOYER" || r.role === "CLIENT")).toBe(false);
  });
  it("does not infer agency identity solely from hostname without matching structured organization", async () => {
    expect((await project(page(pane.replace(/<script\b[\s\S]*?<\/script>/gu, "")))).evidence.organizations).toEqual([]);
  });
  it.each([
    pane.replace('307-UST-R001990_01R</li>', '307-UST-R009999_01R</li>'),
    pane.replace('id="fav-307-UST-R001990_01R"', 'id="fav-307-UST-R009999_01R"'),
    pane.replace('"value":"307-UST-R001990_01R"', '"value":"307-UST-R009999_01R"'),
    pane.replace('class="block__wrapper', 'data-job-id="different" class="block__wrapper'),
    pane.replace('https://www.facebook.com/sharer/sharer.php?u=https://www.randstad.fr/emploi/technicien-de-preparation-de-matieres-premieres-fh_strasbourg_307-ust-r001990_01r/', 'https://www.randstad.fr/emploi/other_307-ust-r009999_01r/'),
  ])("fails closed on conflicting explicit current-job references", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(randstadId); expect(acquisition.contexts).toBeUndefined();
    const evidence = await extractor.extract(observation);
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.engagements).toEqual([]); expect(evidence.organizations).toEqual([]);
  });
  it.each([
    "", pane + pane,
    pane.replace('header--job-detail--alternative', 'unknown-header'),
    pane.replace('wrapper job-details', 'wrapper unknown-details'),
    pane.replace('behat-referenceNumber', 'unknown-reference'),
    pane.replace('behat-location', 'unknown-location').replace('behat-location', 'unknown-location'),
    pane.replace('descriptif du poste', 'wrong body'),
    pane.replace('class="basic-layout__main"', 'class="basic-layout__main"><input value="search"'),
  ])("fails closed on unsupported/ambiguous boundaries and strips legacy mapped fields", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.contexts).toBeUndefined(); expect(acquisition.content.structuredPayload).toBeUndefined();
    const stale = { ...observation, title: "Other title H/F", locationText: "Paris", displayedCompanyName: "Randstad France", salaryText: "100000 - 200000 EUR / YEAR", contractText: "FULL_TIME" };
    const before = structuredClone(stale);
    const evidence = await extractor.extract(stale);
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.engagements).toEqual([]); expect(evidence.organizations).toEqual([]);
    expect(stale).toEqual(before);
  });
  it("ignores duplicate matching structured jobs but retains validated DOM facts", async () => {
    const duplicate = /<script\b[\s\S]*?<\/script>/u.exec(pane)![0];
    const { evidence, canonical } = await project(page(pane + duplicate));
    expect(canonical.compensation.value?.minimum).toBe(29000);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INDEFINITE"]);
    expect(evidence.organizations).toEqual([]);
  });
  it("does not accept structured data when DOM cannot be bounded", async () => {
    const onlyScript = /<script\b[\s\S]*?<\/script>/u.exec(pane)![0];
    expect((await project(page(onlyScript))).evidence.compensations).toEqual([]);
  });
  it("uses only a unique matching posting when unrelated jobs are also present", async () => {
    const other = /<script\b[\s\S]*?<\/script>/u.exec(pane)![0].replaceAll("307-UST-R001990_01R", "307-UST-R009999_01R").replace('"employmentType":"FULL_TIME"', '"employmentType":"PART_TIME"');
    expect((await project(page(pane + other))).canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
  });
  it("rejects a matching posting whose explicit URL conflicts with its reference", async () => {
    const html = pane.replace('"@type":"JobPosting",', '"@type":"JobPosting","url":"https://www.randstad.fr/emploi/other_307-ust-r009999_01r/",');
    expect(capture(page(html)).acquisition.contexts).toBeUndefined();
    expect((await project(page(html))).evidence.engagements).toEqual([]);
  });
  it.each(["https://www.randstad.fr/emploi/", "https://www.randstad.fr/agence/"])("does not fall back to full-page extraction on unsupported routes: %s", async url => {
    const { acquisition, observation } = capture(page(), url);
    expect(acquisition.externalId).toBeUndefined(); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each(["29 000 € - 31 000 €", "29 000 € - 31 000 € per something"])("does not guess a missing or malformed compensation period: %s", async salary => {
    const html = page(pane.replace("29 000 € - 31 000 € par année", salary));
    expect((await project(html)).evidence.compensations).toEqual([]);
    expect((await project(html)).canonical.compensation.status).toBe("UNKNOWN");
  });
  it("re-extracts immutable legacy mapped content into normal evidence", async () => {
    const observation = capture().observation;
    const legacy = { ...observation, title: "Unsafe other role H/F", contractText: "PART_TIME", salaryText: "100000 EUR / YEAR" };
    const before = structuredClone(legacy);
    const evidence = await extractor.extract(legacy);
    expect(evidence.compensations[0]?.minimum).toBe(29000);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(legacy).toEqual(before);
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: randstadUrl, pageTitle: "Randstad", html: page(), visibleText: "Randstad vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("polyvalence", "polyvalence professionnelle")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("Randstad France");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: randstadUrl.replace(randstadId, "307-ust-r001991_01r"), html: page().replaceAll(randstadId, "307-ust-r001991_01r").replaceAll(randstadId.toUpperCase(), "307-UST-R001991_01R"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
