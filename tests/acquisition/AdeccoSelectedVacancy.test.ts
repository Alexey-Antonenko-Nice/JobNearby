import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createVacancyPositionCountEvidence } from "../../src/domain/evidence/VacancyPositionCountEvidence.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
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
import { adeccoId, adeccoSearchUrl, adeccoDirectUrl, adeccoHeader, adeccoDescription, adeccoPane, adeccoOutside, adeccoPage } from "../fixtures/adeccoSelectedVacancy.js";

const extractor = createVacancyEvidenceExtractor();
function capture(html = adeccoPage(), pageUrl = adeccoSearchUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Adecco results",
    visibleText: "Strasbourg, France\nTélétravail\nTechnicien de Maintenance CVC (h/f)\n€ 34000 - € 38250 / Annuel\nau moins 5 ans d'expérience", capturedAt: "2026-10-22T12:00:00Z" }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(html = adeccoPage()) {
  const { observation } = capture(html);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-22") },
  });
  return { evidence, canonical };
}

describe("Adecco selected vacancy capture", () => {
  it("recognizes the bounded selected pane and the matching reference/detail-link identity", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "adecco.com", externalId: adeccoId });
    expect(acquisition.contexts).toHaveLength(1);
    expect(acquisition.contexts![0]).toMatchObject({ providerKey: "ADECCO", providerExternalId: adeccoId });
    expect(acquisition.contexts![0]!.text).not.toMatch(/CVC|38250|ILLKIRCH|Télétravail|5 ans|Footer Company/);
    expect(observation.metadata.acquisition).toMatchObject({ html: adeccoPage() });
  });
  it("resolves selected title/location, salary, contract, full-time, and position count", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Technicien de Maintenance (h/f)" } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "STRASBOURG, Bas-Rhin" } });
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { currency: "EUR", minimum: 34000, maximum: 44000, period: "YEAR" } });
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(canonical.positionCount).toMatchObject({ status: "RESOLVED", value: { type: "EXACT", value: 1 } });
    expect(canonical.workMode.status).toBe("UNKNOWN");
    expect(canonical.experienceRequirements.status).toBe("UNKNOWN");
    expect(evidence.languageRequirements).toEqual([]);
    expect(evidence.travelRequirements).toEqual([]);
    expect(canonical.canonicalizationStatus).toBe("USABLE");
  });
  it("preserves start date and private-organization metadata only in bounded source context", () => {
    const { acquisition } = capture();
    expect(acquisition.contexts![0]!.text).toContain("Début de contrat : 04-01-2027");
    expect(acquisition.contexts![0]!.text).toContain("Organisation : Privée");
    expect(acquisition.structuredFields?.publishedAt).toBeUndefined();
    expect(acquisition.structuredFields).not.toHaveProperty("startDate");
  });
  it("does not infer full-time from CDI", async () => {
    expect((await project(adeccoPage(adeccoPane(adeccoHeader.replace("Temps plein", "39 h/semaine"))))).canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("keeps explicit named cabinet/recruiter evidence separate from the unnamed employer", async () => {
    const { canonical } = await project();
    expect(canonical.organizationRelationships).toContainEqual(expect.objectContaining({ role: "RECRUITER", rawName: "Cabinet Adecco Recrutement" }));
    expect(canonical.organizationRelationships.some((r) => r.role === "EMPLOYER" || r.role === "CLIENT")).toBe(false);
  });
  it("does not manufacture agency identity from the provider hostname", async () => {
    expect((await project(adeccoPage(adeccoPane(adeccoHeader, '<div class="VacancyDescription">Maintenance industrielle.</div>')))).evidence.organizations).toEqual([]);
  });
  it("keeps search and tracking parameters out of identity", () => {
    expect(capture(adeccoPage(), "https://www.adecco.com/fr-fr/offres-emploi?jobLocation=Paris&radius=100&utm_source=test").observation.source.externalId).toBe(adeccoId);
  });
  it.each([
    adeccoPane().replace(`<b class="job-id">${adeccoId}`, '<b class="job-id">9999999999'),
    adeccoPane().replace('<section class="JobSearch_generatedClass job_Details">', '<section class="job_Details" data-job-id="9999999999">'),
    adeccoPane().replace("</section></section></section>", `<a href="${adeccoDirectUrl.replace(adeccoId, "9999999999")}">Other job</a></section></section></section>`),
  ])("fails closed for conflicting selected identifiers", async (pane) => {
    const { acquisition, observation } = capture(adeccoPage(pane));
    expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each([
    "", adeccoPane() + adeccoPane(), adeccoPane().replace("job_Details", "unknown-pane"),
    adeccoPane().replace("VacancyDescription", "unknown-description"),
    adeccoPane().replace("scrollbar-box", "unknown-header"),
    adeccoPane().replace("static_jobdetailpage_url", "unknown-link"),
    adeccoPane().replace(adeccoDirectUrl, "https://evil.example/fr-fr/offres-emploi/job/" + adeccoId),
    adeccoPane(adeccoHeader, adeccoDescription + adeccoOutside),
  ])("fails closed for missing/ambiguous/unsupported selected panes", async (pane) => {
    const { acquisition, observation } = capture(adeccoPage(pane));
    expect(acquisition.contexts).toBeUndefined();
    const evidence = await extractor.extract({ ...observation, title: "CVC title H/F", locationText: "Search Strasbourg", salaryText: "100000 EUR / YEAR", contractText: "FULL_TIME", displayedCompanyName: "Unsafe Agency" });
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.organizations).toEqual([]); expect(evidence.locations).toEqual([]);
    expect(evidence.compensations).toEqual([]); expect(evidence.engagements).toEqual([]); expect(evidence.positionCounts).toBeUndefined();
  });
  it("preserves direct URL identity while leaving unvalidated direct-page layouts unsupported", async () => {
    const { acquisition, observation } = capture(adeccoPage(), adeccoDirectUrl);
    expect(acquisition.externalId).toBe(adeccoId);
    expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it("does not let page-level structured jobs bypass selected-pane checks", async () => {
    const html = adeccoPage("") + '<script type="application/ld+json">{"@type":"JobPosting","title":"Other role H/F","baseSalary":"100000"}</script>';
    expect(capture(html).acquisition.content.structuredPayload).toBeUndefined();
    expect((await extractor.extract(capture(html).observation)).compensations).toEqual([]);
  });
  it("re-extracts the old ID-less capture without changing source content", async () => {
    const observation = capture().observation;
    const { externalId: _, ...source } = observation.source;
    const old = { ...observation, source, metadata: { acquisition: { html: adeccoPage() } } };
    const before = structuredClone(old);
    expect((await extractor.extract(old)).positionCounts?.[0]?.value).toBe(1);
    expect(old).toEqual(before);
  });
  it("validates position counts and requires source-consistent provenance", () => {
    const provenance = { sourceObservationId: "one", extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1 };
    for (const value of [0, -1, 1.5, Infinity]) expect(() => createVacancyPositionCountEvidence({ value, rawText: "count", provenance })).toThrow();
    expect(() => createExtractedVacancyEvidence({ sourceObservationId: "other", positionCounts: [{ value: 1, rawText: "count", provenance }] })).toThrow("originate");
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: adeccoSearchUrl, pageTitle: "Adecco", html: adeccoPage(), visibleText: "Adecco selected vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: adeccoPage(adeccoPane(adeccoHeader, adeccoDescription.replace("curative", "corrective"))), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("Cabinet Adecco Recrutement");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: adeccoPage().replaceAll(adeccoId, "2129846002"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
