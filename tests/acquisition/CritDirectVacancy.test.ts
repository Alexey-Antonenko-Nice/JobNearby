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
import { employerConfirmationCandidate } from "../../src/application/user/employerConfirmation.js";
import { getRecruitingAgencyProjection } from "../../src/application/user/recruitingAgencyReview.js";
import { normalizeOrganizationEvidenceName } from "../../src/domain/evidence/OrganizationEvidence.js";
const critId = "1e5128d8-42dd-4d6a-9f04-37cdb5922cf8";
const critUrl = `https://www.crit-job.com/offres/${critId}`;
const branch = "CRIT ILLKIRCH-GRAFFENSTADEN Industrie";
const pane = readFileSync("tests/fixtures/critDirectVacancy.html", "utf8");
const outside = '<nav>Other role H/F, Paris, CDI, 100000 EUR / YEAR</nav><footer>Footer Agency recrute</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = critUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Crit vacancy",
    visibleText: "Other role H/F, Paris, CDI, 100000 EUR / YEAR", capturedAt: "2026-10-22T12:00:00Z" }, "acquisition");
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
describe("Crit direct vacancy", () => {
  it("recognizes provider, UUID identity and bounded current vacancy", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "crit-job.com", externalId: critId });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "CRIT", providerExternalId: critId });
    expect(acquisition.contexts?.[0]?.text).not.toMatch(/Footer Agency|Other role|100000|About the company|Bien plus|CDI Intérimaire/);
    expect(observation.metadata.acquisition).toMatchObject({ html: page() });
  });
  it("resolves heading, location with postal code and bounded hourly compensation", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Technicien de maintenance incendie H/F" } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Strasbourg (67000)" } });
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { currency: "EUR", minimum: 13, maximum: 16, period: "HOUR" } });
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "13,00 € to 16,00 € per hour", minimum: 13, maximum: 16, period: "HOUR", provenance: expect.objectContaining({ contentOrigin: "SELECTED_VACANCY_CONTEXT" }) })]);
  });
  it("preserves interim and CDI evidence as two conflicted full-time alternatives", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.engagements.map(e => e.normalizedTerms)).toEqual([["INTERIM", "FULL_TIME"], ["INDEFINITE", "FULL_TIME"]]);
    expect(evidence.engagements[0]?.rawTerms).toContain("intérim (Job description)");
    expect(evidence.engagements[1]?.rawTerms).toContain("CDI (Job description)");
    expect(canonical.engagement.status).toBe("CONFLICTED");
    expect(canonical.engagement.alternatives?.map(a => a.value.normalizedTerms)).toEqual([["INTERIM", "FULL_TIME"], ["INDEFINITE", "FULL_TIME"]]);
    expect(canonical.engagement.alternatives?.every(a => a.supportingEvidenceIds.length > 0)).toBe(true);
    expect(canonical.canonicalizationStatus).toBe("CONFLICTED");
  });
  it("does not infer full-time when the explicit schedule is absent", async () => {
    const { evidence, canonical } = await project(page(pane.replace("Intérim - Temps plein", "Intérim")));
    expect(evidence.engagements.every(e => !e.normalizedTerms.includes("FULL_TIME"))).toBe(true);
    expect(canonical.engagement.status).toBe("CONFLICTED");
  });
  it("resolves interim when the current description has no CDI contradiction, ignoring company marketing", async () => {
    const html = pane.replaceAll("en CDI.", "en intérim.").replace("Le contrat est un CDI", "Le contrat est un intérim");
    expect((await project(page(html))).canonical.engagement).toMatchObject({ status: "RESOLVED", value: { normalizedTerms: ["INTERIM", "FULL_TIME"] } });
  });
  it("deduplicates equivalent experience meanings while retaining individual audit evidence", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.experienceRequirements.length).toBeGreaterThanOrEqual(3);
    expect(canonical.experienceRequirements).toMatchObject({ status: "RESOLVED", value: [expect.objectContaining({ minimumYears: 1, maximumYears: 2, unit: "YEAR" })] });
    expect(canonical.experienceRequirements.value).toHaveLength(1);
    expect(canonical.experienceRequirements.supportingEvidenceIds).toHaveLength(evidence.experienceRequirements.length);
  });
  it("retains contract duration, start date, education and publication safely", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.contexts?.[0]?.text).toContain("18 mois");
    expect(acquisition.contexts?.[0]?.text).toContain("Dès que possible");
    expect(acquisition.contexts?.[0]?.text).toContain("BEP/CAP");
    expect(observation.publishedAt).toEqual(new Date("2026-09-30T13:05:27Z"));
    expect((await project()).canonical.educationRequirements.status).toBe("UNKNOWN");
    expect(acquisition.structuredFields).not.toHaveProperty("contractDuration");
    expect(acquisition.structuredFields).not.toHaveProperty("startDate");
  });
  it("classifies the explicit client-facing branch independently of memory and suppresses employer confirmation", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: branch, role: "STAFFING_AGENCY" }));
    expect(canonical.organizationRelationships.some(o => o.role === "CLIENT" || o.role === "EMPLOYER")).toBe(false);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
    const lookupNames: string[] = [];
    const projection = await getRecruitingAgencyProjection(canonical, { findByNormalizedName: async name => { lookupNames.push(name); return []; }, append: async () => false });
    expect(projection.context.candidates).toHaveLength(1);
    expect(projection.context.known).toEqual([]);
    expect(lookupNames).toEqual([normalizeOrganizationEvidenceName(branch)]);
  });
  it("does not infer intermediary status solely from the hostname or company marketing", async () => {
    const html = pane.replaceAll("notre client", "notre équipe");
    expect((await project(page(html))).evidence.organizations.some(o => o.role === "STAFFING_AGENCY")).toBe(false);
  });
  it("retains intermediary safety when the description instead says the client is recruiting", async () => {
    const html = pane.replace("nous recherchons pour notre client", "nous recrutons en interne");
    const { canonical } = await project(page(html));
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "STAFFING_AGENCY", rawName: branch }));
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
  });
  it("retains explicit named client evidence for the existing review rules", async () => {
    const html = pane.replace("pour notre client, spécialisé", "pour notre client, ACME Industrie, spécialisé");
    const { canonical } = await project(page(html));
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "CLIENT", rawName: "ACME Industrie" }));
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
  });
  it.each([
    pane.replace('"url":"https://www.crit-job.com/offres/' + critId, '"url":"https://www.crit-job.com/offres/2e5128d8-42dd-4d6a-9f04-37cdb5922cf8'),
    pane.replace('"value":"' + critId, '"value":"2e5128d8-42dd-4d6a-9f04-37cdb5922cf8'),
    pane.replace('<h1 ', '<h1 data-offer-id="2e5128d8-42dd-4d6a-9f04-37cdb5922cf8" '),
  ])("fails closed for conflicting current UUID identities", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(critId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).engagements).toEqual([]);
  });
  it.each([
    "", pane + pane, pane.replace("Job description</h2>", "Unknown description</h2>"),
    pane.replace("Desired profile</h2>", "Unknown profile</h2>"), pane.replace("Summary</h2>", "Unknown summary</h2>"),
    pane.replace("Other information</h2>", "Unknown other</h2>"), pane.replace("Offer posted on", "Unknown publication"),
    pane.replace("Job description</h2>", 'Job description</h2><input value="search">'),
  ])("fails closed for missing or ambiguous boundaries, including stale mapped fields", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.contexts).toBeUndefined(); expect(acquisition.content.structuredPayload).toBeUndefined();
    const stale = { ...observation, title: "Wrong role H/F", locationText: "Wrong city", displayedCompanyName: branch, salaryText: "100000 EUR / YEAR", contractText: "FULL_TIME" };
    const before = structuredClone(stale);
    const evidence = await extractor.extract(stale);
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.engagements).toEqual([]); expect(evidence.organizations).toEqual([]);
    expect(stale).toEqual(before);
  });
  it.each(["https://www.crit-job.com/offres", "https://www.crit-job.com/offres/not-a-uuid"])("does not parse unsupported routes: %s", async url => {
    const { acquisition, observation } = capture(page(), url);
    expect(acquisition.externalId).toBeUndefined(); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it("does not use unmatched or ambiguous structured data to override visible contradictions", async () => {
    const script = /<script\b[\s\S]*?<\/script>/u.exec(pane)![0];
    const { canonical, evidence } = await project(page(pane + script));
    expect(canonical.engagement.status).toBe("CONFLICTED");
    expect(evidence.organizations).toEqual([]);
    expect(canonical.compensation.value?.minimum).toBe(13);
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: critUrl, pageTitle: "Crit", html: page(), visibleText: "Crit vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("maintenance préventive", "maintenance préventive approfondie")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("CRIT ILLKIRCH-GRAFFENSTADEN Industrie");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: critUrl.replace(critId, "2e5128d8-42dd-4d6a-9f04-37cdb5922cf8"), html: page().replaceAll(critId, "2e5128d8-42dd-4d6a-9f04-37cdb5922cf8"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
