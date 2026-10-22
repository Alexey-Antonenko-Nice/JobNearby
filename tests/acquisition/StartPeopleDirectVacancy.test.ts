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
const offerId = "9481983";
const startUrl = "https://www.startpeople.fr/offre-emploi/strasbourg/coordinateur-technique-referent-atelier-h-f/9481983";
const branch = "Start People STRASBOURG BTP";
const pane = readFileSync("tests/fixtures/startPeopleDirectVacancy.html", "utf8");
const outside = '<nav>Other role H/F Paris 100000 EUR / YEAR, 10 ans minimum</nav><footer>Other Agency recrute</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = startUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Start People",
    visibleText: "600+ agences Other role H/F, Paris, 100000 EUR / YEAR", capturedAt: "2026-10-22T12:00:00Z" }, "acquisition");
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
describe("Start People direct vacancy", () => {
  it("recognizes the provider, numeric direct route and matching visible reference", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "startpeople.fr", externalId: offerId });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "START_PEOPLE", providerExternalId: offerId });
    expect(capture(page(), startUrl + "?utm_source=test#details").acquisition.externalId).toBe(offerId);
  });
  it("bounds title, summary and profile while excluding page chrome", () => {
    const context = capture().acquisition.contexts![0]!;
    expect(context.text).not.toMatch(/Other role|100000|10 ans|Vos avantages|Partager/);
    expect(context.html).toContain("BTP"); expect(context.html).toContain("9481983");
  });
  it("preserves the literal title and vacancy workplace", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role.value?.title).toBe("Coordinateur technique /Référent Atelier (H/F)");
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "STRASBOURG (67)", role: "WORKPLACE" })]);
    expect(canonical.location.value?.rawText).toBe("STRASBOURG (67)");
  });
  it("exposes the full visible salary range in normal evidence and canonical projection", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "entre 28000.00 et 38000.00€ / an", minimum: 28000, maximum: 38000, currency: "EUR", period: "YEAR" })]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 28000, maximum: 38000, currency: "EUR", period: "YEAR" } });
    expect(canonical.compensation.supportingEvidenceIds).not.toEqual([]);
  });
  it("exposes CDI and identity-matched structured full-time with understandable provenance", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.engagement.value?.normalizedTerms).toEqual(expect.arrayContaining(["INDEFINITE", "FULL_TIME"]));
    expect(evidence.engagements).toContainEqual(expect.objectContaining({ rawTerms: ["JobPosting[9481983].employmentType=FULL_TIME"], provenance: expect.objectContaining({ extractionMethod: "DIRECT_FIELD" }) }));
  });
  it("does not infer hours from CDI without matched structured data", async () => {
    const { canonical } = await project(page(pane.replace(/<script[\s\S]*?<\/script>/giu, "")));
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("can use explicit bounded working hours", async () => {
    const { canonical } = await project(page(pane.replace(/<script[\s\S]*?<\/script>/giu, "").replace("CDI </p>", "CDI Temps plein</p>")));
    expect(canonical.engagement.value?.normalizedTerms).toContain("FULL_TIME");
  });
  it("retains both genuine experience ranges without inventing a third minimum", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.experienceRequirements).toHaveLength(2);
    expect(evidence.experienceRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ minimumYears: 2, maximumYears: 3 }), expect.objectContaining({ minimumYears: 2, maximumYears: 5, rawText: "Expérience de 2 à 5 ans minimum" })]));
    expect(canonical.experienceRequirements.value).toHaveLength(2);
  });
  it("retains a genuinely separate minimum requirement", async () => {
    const { evidence } = await project(page(pane.replace("Aptitudes :", "5 ans minimum en maintenance. Aptitudes :")));
    expect(evidence.experienceRequirements).toContainEqual(expect.objectContaining({ minimumYears: 5, rawText: "5 ans minimum" }));
  });
  it("retains sector source-only and publication in existing source support", async () => {
    expect(capture().observation.publishedAt).toEqual(new Date("2026-09-15T00:00:00Z"));
    expect((await project()).canonical.industryContexts.status).toBe("UNKNOWN");
  });
  it("classifies the branch as staffing and suppresses employer confirmation", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: branch, role: "DISPLAYED_COMPANY" }), expect.objectContaining({ value: branch, role: "STAFFING_AGENCY" })]);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
    expect(canonical.organizationRelationships.some(item => item.role === "CLIENT" || item.role === "EMPLOYER")).toBe(false);
    const projection = await getRecruitingAgencyProjection(canonical, { findByNormalizedName: async () => [], append: async () => false });
    expect(projection.context.candidates).toHaveLength(1);
  });
  it("does not classify generic agency wording without the client relationship", async () => {
    const { evidence } = await project(page(pane.replace("Notre client,", "Notre société,")));
    expect(evidence.organizations.some(item => item.role === "STAFFING_AGENCY")).toBe(false);
  });
  it("exposes the offer number as external identifier evidence", async () => {
    expect((await project()).evidence.externalIdentifiers).toContainEqual(expect.objectContaining({ value: offerId }));
  });
  it("ignores unrelated structured jobs and cannot silently override visible salary or location", async () => {
    const html = pane.replace('"minValue": 28000', '"minValue": 90000').replace('"employmentType": "FULL_TIME"', '"employmentType": "PART_TIME"').replace('"value": "9481983"', '"value": "9999999"').replaceAll(startUrl, startUrl.replace(offerId, "9999999"));
    const { canonical } = await project(page(html));
    expect(canonical.compensation.value?.minimum).toBe(28000);
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("does not use ambiguous matched structured hours", async () => {
    const script = pane.match(/<script[\s\S]*?<\/script>/iu)![0];
    expect((await project(page(pane + script))).canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it.each([
    pane.replace('>9481983</p>', '>9481984</p>'),
    pane.replace('data-ref="9481983"', 'data-ref="9481984"'),
    pane.replace('href="/postuler/9481983"', 'href="/postuler/9481984"'),
    pane.replace('"value": "9481983"', '"value": "9481984"'),
  ])("fails closed on conflicting identities and keeps trusted URL ID", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(offerId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each(["", pane + pane, pane.replace("description-offre", "unknown"), pane.replace("Votre agence", "Unknown"), pane.replace("block-info-select-job", "unknown")])("fails closed without falling back to old mapped fields", async html => {
    const { observation } = capture(page(html));
    const stale = { ...observation, title: "Wrong role", salaryText: "100000 EUR / YEAR", contractText: "FULL_TIME", locationText: "Agency address", displayedCompanyName: "Wrong company" };
    const before = structuredClone(stale); const evidence = await extractor.extract(stale);
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.compensations, evidence.engagements, evidence.organizations]) expect(items).toEqual([]);
    expect(stale).toEqual(before);
  });
  it.each(["https://www.startpeople.fr/offres", "https://www.startpeople.fr/agence/222/strasbourg-btp", startUrl.replace("9481983", "abc")])("does not extract vacancy facts from unsupported routes", async url => {
    const { acquisition, observation } = capture(page(), url);
    expect(acquisition.externalId).toBeUndefined(); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).compensations).toEqual([]);
  });
  it.each(["entre 38000.00 et 28000.00€ / an", "entre xxx et 38000.00€ / an", "Salaire à négocier"])("rejects unsupported or malformed salary without using hidden structured salary", async salary => {
    expect((await project(page(pane.replace("entre 28000.00 et 38000.00€ / an", salary)))).canonical.compensation.status).toBe("UNKNOWN");
  });
  it("validates provider hostname instead of trusting a lookalike route", () => {
    const { acquisition } = capture(page(), startUrl.replace("www.startpeople.fr", "startpeople.fr.evil.test"));
    expect(acquisition.contexts).toBeUndefined(); expect(acquisition.externalId).toBeUndefined();
  });
  it("preserves named-client review semantics", async () => {
    const { evidence } = await project(page(pane.replace("Notre client, spécialiste", "Nous recrutons pour notre client ACME. Notre client, spécialiste")));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ role: "CLIENT", value: "ACME" }));
  });
  it("keeps provider evidence provenance attached to all normal projected facts", async () => {
    const { evidence } = await project();
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.compensations, ...evidence.engagements, ...evidence.organizations, ...evidence.experienceRequirements]) {
      expect(item.provenance).toMatchObject({ sourceObservationId: "observation", contentOrigin: "SELECTED_VACANCY_CONTEXT" });
    }
  });
  it("accepts decimal commas and case-insensitive explicit annual periods", async () => {
    const { evidence } = await project(page(pane.replace("entre 28000.00 et 38000.00€ / an", "entre 28000,00 et 38000,00€ / AN")));
    expect(evidence.compensations[0]).toMatchObject({ minimum: 28000, maximum: 38000, period: "YEAR" });
  });
  it("rejects reversed experience ranges without creating a false minimum or throwing", async () => {
    const { evidence } = await project(page(pane.replace("Expérience de 2 à 5 ans minimum", "Expérience de 5 à 2 ans minimum")));
    expect(evidence.experienceRequirements).toHaveLength(1);
    expect(evidence.experienceRequirements[0]).toMatchObject({ minimumYears: 2, maximumYears: 3 });
  });
  it("does not borrow structured hours from a foreign URL despite a reused identifier", async () => {
    const { canonical } = await project(page(pane.replaceAll(startUrl, "https://other.example/jobs/9481983")));
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: startUrl, pageTitle: "Start People", html: page(), visibleText: "Start People vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("Vos missions principales seront:", "Vos missions principales sont:")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("Start People STRASBOURG BTP");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: startUrl.replace(offerId, "9481984"), html: page().replaceAll(offerId, "9481984"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
