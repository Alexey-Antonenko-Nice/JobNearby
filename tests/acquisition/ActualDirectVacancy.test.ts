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
import { actualFacts } from "../../src/application/acquisition/ActualVacancy.js";
const actualId = "RE1254192A397912";
const actualUrl = "https://www.actualgroup.com/offres-emploi/teleconseiller-h-f-lu-re1254192a397912";
const branch = "Actual emploi Schiltigheim";
const pane = readFileSync("tests/fixtures/actualDirectVacancy.html", "utf8");
const outside = '<nav>600+ agences Other role H/F, Paris, 100000 EUR / YEAR</nav><footer>Unrelated Agency recrute</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = actualUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Actual page title",
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
describe("Actual direct vacancy", () => {
  it("recognizes the direct route and normalizes the offer reference independently of URL casing/tracking", () => {
    for (const url of [actualUrl, actualUrl.replace(actualId.toLowerCase(), actualId) + "?utm_source=test#details"]) {
      const { acquisition, observation } = capture(page(), url);
      expect(observation.source).toMatchObject({ sourceName: "actualgroup.com", externalId: actualId });
      expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "ACTUAL", providerExternalId: actualId });
    }
  });
  it("captures one job boundary and retains agency contacts only in bounded HTML", () => {
    const { acquisition, observation } = capture();
    const context = acquisition.contexts?.[0];
    expect(context?.text).not.toMatch(/600\+ agences|Other role|100000|Offres similaires|L'entreprise|Actual Strasbourg|67300|08h30|22 avenue/);
    expect(context?.html).toContain("22 avenue De L'Europe");
    expect(context?.html).toContain("67300 Schiltigheim");
    expect(context?.html).toContain("08h30 - 18h");
    expect(observation.metadata.acquisition).toMatchObject({ html: page() });
  });
  it("uses the literal current heading and workplace badge, with explicit CDI/full-time and no salary", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Teleconseiller (H/F)" } });
    expect(canonical.location).toMatchObject({ status: "RESOLVED", value: { rawText: "STRASBOURG, 67100, Grand Est" } });
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "STRASBOURG, 67100, Grand Est", role: "WORKPLACE" })]);
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(canonical.compensation.status).toBe("UNKNOWN"); expect(evidence.compensations).toEqual([]);
    expect(canonical.positionCount).toMatchObject({ status: "RESOLVED", value: { type: "EXACT", value: 10 } });
    expect(evidence.positionCounts?.[0]?.rawText).toContain("Nous recrutons 10 Téléconseillers");
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.engagements, ...evidence.organizations, ...(evidence.positionCounts ?? [])]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it("preserves an accented heading when the source supplies it", async () => {
    const html = pane.replace(" Teleconseiller (H/F)</h1>", " Téléconseiller (H/F)</h1>");
    expect((await project(page(html))).canonical.role.value?.title).toBe("Téléconseiller (H/F)");
  });
  it("does not infer full-time from CDI or agency opening hours", async () => {
    const html = pane.replace(/temps plein/giu, "Horaire non précisé");
    expect((await project(page(html))).canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("can use explicit full-time wording from the current job when the badge is absent", async () => {
    const html = pane.replace('<span data-slot="label" class="truncate">Temps plein</span>', '<span data-slot="label" class="truncate">Non précisé</span>');
    const { canonical, evidence } = await project(page(html));
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(evidence.engagements[0]?.rawTerms).toContain("Temps plein (Le poste)");
  });
  it.each([
    pane.replace("Nous recrutons 10 Téléconseillers", "Nous recrutons 10 Electriciens"),
    pane.replace("Nous recrutons 10 Téléconseillers", "Nous recrutons des Téléconseillers"),
    pane.replace("Nous recrutons 10 Téléconseillers", "Nous recrutons 0 Téléconseillers"),
    pane.replace("Nous recrutons 10 Téléconseillers", "Nous recrutons 10 Téléconseillers. Nous recrutons 11 Téléconseillers"),
  ])("does not invent counts for unrelated roles, missing counts or contradictory current-role counts", async html => {
    expect((await project(page(html))).canonical.positionCount.status).toBe("UNKNOWN");
  });
  it("prefers one explicit agency-card identity and blocks employer confirmation", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: branch, role: "DISPLAYED_COMPANY" }), expect.objectContaining({ value: branch, role: "STAFFING_AGENCY" })]);
    expect(evidence.organizations.some(o => /L'entreprise|Actual Strasbourg|Actual Schiltigheim$/.test(o.value))).toBe(false);
    expect(canonical.organizationRelationships.some(o => o.role === "CLIENT" || o.role === "EMPLOYER")).toBe(false);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
    const lookup: string[] = [];
    const projection = await getRecruitingAgencyProjection(canonical, { findByNormalizedName: async name => { lookup.push(name); return []; }, append: async () => false });
    expect(projection.context.candidates).toHaveLength(1);
    expect(projection.context.known).toEqual([]);
    expect(lookup).toEqual([normalizeOrganizationEvidenceName(branch)]);
  });
  it("uses only explicit agency-card names without globally stripping organization words", async () => {
    const html = pane.replaceAll(branch, "Notre Agence Actual Exemple");
    const { evidence } = await project(page(html));
    expect(evidence.organizations.map(o => o.value)).toEqual(["Notre Agence Actual Exemple", "Notre Agence Actual Exemple"]);
  });
  it("uses explicit client recruiting language independently of staffing-card wording", async () => {
    const html = pane.replace("Agence d’intérim, emploi, recrutement, CDI, CDD et missions temporaires", "Société de conseil");
    expect((await project(page(html))).canonical.organizationRelationships).toContainEqual(expect.objectContaining({ rawName: branch, role: "RECRUITER" }));
  });
  it("does not classify generic agency wording as staffing without recruiting evidence", async () => {
    const html = pane.replace("Agence d’intérim, emploi, recrutement, CDI, CDD et missions temporaires", "Agence de design")
      .replace("pour l'un de nos client", "dans notre équipe");
    expect((await project(page(html))).evidence.organizations).toEqual([expect.objectContaining({ value: branch, role: "DISPLAYED_COMPANY" })]);
  });
  it("does not turn a changed agency address or hours into workplace or engagement", async () => {
    const html = pane.replaceAll("67300 Schiltigheim", "75000 Paris").replaceAll("08h30 - 18h", "18h - 21h");
    const { evidence, canonical } = await project(page(html));
    expect(evidence.locations.map(o => o.value)).toEqual(["STRASBOURG, 67100, Grand Est"]);
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
  });
  it("ignores a separate agency finder card outside the current heading section", async () => {
    const finder = actualFacts(pane)!.agencyCard.replaceAll(branch, "Another agency Paris");
    const { evidence } = await project(page(pane.replace("</main>", finder + "</main>")));
    expect(evidence.locations.map(item => item.value)).toEqual(["STRASBOURG, 67100, Grand Est"]);
    expect(evidence.organizations.map(item => item.value)).toEqual([branch, branch]);
  });
  it("preserves category without claiming employer industry", async () => {
    expect(capture().acquisition.contexts?.[0]?.text).toContain("Commerce, Vente et Immobilier");
    expect((await project()).canonical.industryContexts.status).toBe("UNKNOWN");
  });
  it.each([
    pane.replace('rel="canonical" href="' + actualUrl, 'rel="canonical" href="' + actualUrl.replace("re1254192a397912", "re1254192a397913")),
    pane.replace('<h1 ', '<h1 data-offer-id="RE1254192A397913" '),
    pane.replace('</h1>', '</h1><p>Référence RE1254192A397913</p>'),
  ])("fails closed on explicit conflicting references while retaining URL identity", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(actualId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it("accepts an explicit reference that agrees with the URL", () => {
    expect(capture(page(pane.replace('</h1>', '</h1><p>Référence RE1254192A397912</p>'))).acquisition.contexts).toHaveLength(1);
  });
  it.each([
    "", pane + pane,
    pane.replace("Le poste</h2>", "Unknown job</h2>"), pane.replace("Le profil recherché</h2>", "Unknown profile</h2>"),
    pane.replace("L'entreprise</h2>", "Unknown company</h2>"),
    pane.replace('to="/agences/actual-emploi-schiltigheim-a597"', 'to="/unknown/branch"'),
    pane.replace("STRASBOURG, 67100, Grand Est", "Agency address only"),
    pane.replace("Le poste</h2>", 'Le poste</h2><input value="search">'),
  ])("fails closed for unsupported boundaries and strips stale mapped facts", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.contexts).toBeUndefined(); expect(acquisition.content.structuredPayload).toBeUndefined();
    const stale = { ...observation, title: "Other role H/F", locationText: "Agency address", salaryText: "100000 EUR / YEAR", contractText: "FULL_TIME", displayedCompanyName: "L'entreprise Actual Strasbourg Actual Schiltigheim" };
    const before = structuredClone(stale);
    const evidence = await extractor.extract(stale);
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.engagements).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.organizations).toEqual([]);
    expect(stale).toEqual(before);
  });
  it.each(["https://www.actualgroup.com/offres-emploi", "https://www.actualgroup.com/agences/actual-emploi-schiltigheim-a597", "https://www.actualgroup.com/en/jobs/teleconseiller-re1254192a397912"])("does not use whole-page fallback on unsupported routes: %s", async url => {
    const { acquisition, observation } = capture(page(), url);
    expect(acquisition.externalId).toBeUndefined(); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it("does not let unrelated or conflicting structured jobs inject source facts", async () => {
    const html = page() + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"RE1254192A397913","title":"Wrong title H/F","employmentType":"PART_TIME"}</script>';
    expect(capture(html).acquisition.contexts).toBeUndefined();
    expect((await project(html)).evidence.organizations).toEqual([]);
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: actualUrl, pageTitle: "Actual", html: page(), visibleText: "Actual vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("Vos missions :", "Vos missions principales :")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("Actual emploi Schiltigheim");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: actualUrl.replace(actualId.toLowerCase(), "re1254192a397913"), html: page().replaceAll(actualId.toLowerCase(), "re1254192a397913").replaceAll(actualId, "RE1254192A397913"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
