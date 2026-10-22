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
const synergieId = "626-659";
const synergieUrl = "https://www.synergie.fr/trouver-un-emploi/ingenieur-methodes-f-h-bischheim-67800/offre-626-659";
const pane = readFileSync("tests/fixtures/synergieDirectVacancy.html", "utf8");
const outside = '<nav>Other role F/H, Paris, 100000 EUR / YEAR, CDI</nav><footer>Unrelated Agency recrute</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = synergieUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Offre emploi Interim Ingénieur méthodes F/H Bischheim",
    visibleText: "Other role F/H, Paris, 100000 EUR / YEAR, CDI", capturedAt: "2026-10-22T12:00:00Z" }, "acquisition");
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
describe("Synergie direct vacancy", () => {
  it("recognizes the provider, route and matching URL/page reference", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "synergie.fr", externalId: synergieId });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "SYNERGIE", providerExternalId: synergieId });
    expect(acquisition.contexts?.[0]?.text).not.toMatch(/Other role|100000|Unrelated Agency|Autres offres|Vos démarches|Nos énergies|35-45 K€/);
    expect(observation.metadata.acquisition).toMatchObject({ html: page() });
  });
  it("uses the vacancy heading over the SEO title and resolves mission location, interim and salary", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Ingénieur méthodes F/H" } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "Bischheim - 67800" } });
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM"]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: "35-40 K€", minimum: 35000, maximum: 40000, currency: "EUR" } });
    expect(canonical.compensation.value).not.toHaveProperty("period");
    expect(evidence.compensations).toHaveLength(1);
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.engagements, ...evidence.compensations, ...evidence.organizations]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it.each([["35-40 K€", 35000, 40000], ["35 K€", 35000, undefined], ["40 000 €", 40000, undefined], ["35 000 - 40 000 €", 35000, 40000]] as const)("normalizes salary %s without guessing its period", async (rawText, minimum, maximum) => {
    const { canonical } = await project(page(pane.replaceAll("35-40 K€", rawText)));
    expect(canonical.compensation.value).toEqual({ rawText, currency: "EUR", minimum, ...(maximum === undefined ? {} : { maximum }) });
  });
  it.each(["35-40", "investment 35-40 K€", "35-40 K€ bonus text", "40-35 K€"])("rejects malformed or unrelated salary: %s", async salary => {
    const { evidence, canonical } = await project(page(pane.replaceAll("35-40 K€", salary)));
    expect(evidence.compensations).toEqual([]); expect(canonical.compensation.status).toBe("UNKNOWN");
  });
  it("does not extract unrelated amounts from the vacancy description", async () => {
    const html = page(pane.replaceAll("35-40 K€", "Non précisé").replace("Longue Mission.", "Longue Mission. Budget 100000 EUR / YEAR."));
    expect((await project(html)).evidence.compensations).toEqual([]);
  });
  it("uses explicit visible salary periods", async () => {
    expect((await project(page(pane.replaceAll("35-40 K€", "35-40 K€ par an")))).canonical.compensation.value?.period).toBe("YEAR");
  });
  it("accepts annual metadata only from a unique matched posting with the same salary amounts", async () => {
    const annual = pane.replace('"@type":"JobPosting",', '"@type":"JobPosting","baseSalary":{"currency":"EUR","value":{"minValue":35000,"maxValue":40000,"unitText":"YEAR"}},');
    expect((await project(page(annual))).canonical.compensation.value?.period).toBe("YEAR");
    expect((await project(page(annual.replace('"minValue":35000', '"minValue":34000')))).canonical.compensation.value?.period).toBeUndefined();
    const duplicate = /<script\b[\s\S]*?<\/script>/u.exec(annual)![0];
    expect((await project(page(annual + duplicate))).canonical.compensation.value?.period).toBeUndefined();
  });
  it("preserves publication date, availability and métier without manufacturing lifecycle fields or a second title", async () => {
    expect(capture().observation.publishedAt).toEqual(new Date("2026-02-23T00:00:00Z"));
    expect(capture().acquisition.contexts?.[0]?.text).toContain("Du 26/10/2026 au 28/12/2026");
    const { evidence } = await project();
    expect(evidence.vacancyTitles.map(t => t.value)).toEqual(["Ingénieur méthodes F/H"]);
    expect(capture().acquisition.structuredFields).not.toHaveProperty("startDate");
  });
  it.each(["Notre Agence SYNERGIE Haguenau", "Agence SYNERGIE Haguenau", "SYNERGIE Haguenau"])("produces one logical recruiter for %s", async phrase => {
    const { canonical, evidence } = await project(page(pane.replace("Notre Agence SYNERGIE Haguenau", phrase)));
    expect(evidence.organizations.filter(o => o.role === "RECRUITER")).toEqual([expect.objectContaining({ value: "SYNERGIE Haguenau" })]);
    expect(canonical.organizationRelationships.filter(o => o.role === "RECRUITER")).toEqual([expect.objectContaining({ rawName: "SYNERGIE Haguenau" })]);
    expect(canonical.organizationRelationships.some(o => o.role === "CLIENT" || o.role === "EMPLOYER")).toBe(false);
  });
  it.each([
    pane.replace("626&nbsp;659", "626&nbsp;999"),
    pane.replace('OFFRE - 626', 'OFFRE - 999'),
    pane.replace('<h1 ', '<h1 data-job-id="999-999" '),
    pane.replace('"identifier":"OFFRE - 626', '"identifier":"OFFRE - 999'),
  ])("fails closed for conflicting current vacancy references", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(synergieId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each([
    "", pane + pane,
    pane.replace("Descriptif du poste", "Other description"),
    pane.replaceAll("Détails de l'offre", "Unknown card"),
    pane.replace("Profil recherché", "Unknown profile"),
    pane.replace("A propos de notre client", "Unknown client section"),
    pane.replace('<section class="lg:!mt-0">', '<section class="lg:!mt-0"><input value="search">'),
  ])("fails closed for missing/ambiguous boundaries and stale mapped evidence", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.contexts).toBeUndefined(); expect(acquisition.content.structuredPayload).toBeUndefined();
    const stale = { ...observation, title: "Wrong role F/H", locationText: "Agency city", contractText: "FULL_TIME", salaryText: "100000 EUR / YEAR", displayedCompanyName: "Wrong agency" };
    const before = structuredClone(stale);
    const evidence = await extractor.extract(stale);
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.engagements).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.organizations).toEqual([]);
    expect(stale).toEqual(before);
  });
  it.each(["https://www.synergie.fr/trouver-un-emploi", "https://www.synergie.fr/trouver-une-agence/branch"])("does not parse unsupported routes: %s", async url => {
    const { acquisition, observation } = capture(page(), url);
    expect(acquisition.externalId).toBeUndefined(); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).organizations).toEqual([]);
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: synergieUrl, pageTitle: "Synergie", html: page(), visibleText: "Synergie vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("Longue Mission.", "Très longue Mission.")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("SYNERGIE Haguenau");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: synergieUrl.replace(synergieId, "626-660"), html: page().replaceAll(synergieId, "626-660").replaceAll("626&nbsp;659", "626&nbsp;660").replaceAll("626\u00a0659", "626\u00a0660"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
