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
import { PromanSelectedVacancyContextLocator } from "../../src/application/acquisition/PromanVacancy.js";
const offerId = "1197787";
const promanUrl = "https://mon-espace.proman-emploi.fr/dashboard?offre_id=1197787";
const branch = "PROMAN AIX EXPERTISE 2";
const pane = readFileSync("tests/fixtures/promanSelectedVacancy.html", "utf8");
const outside = '<nav>PROMAN intérim recrutement</nav><article><h2>Wrong job H/F</h2>PARIS (75) CDI Temps partiel 100000 EUR / YEAR 10 ans minimum Wrong Agency recrute</article><aside>ACCOUNT_PERSON SecretSessionValue</aside>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function capture(html = page(), pageUrl = promanUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "PROMAN",
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
describe("PROMAN authenticated selected vacancy", () => {
  it("recognizes the exact dashboard host and primary URL offer ID", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "mon-espace.proman-emploi.fr", externalId: offerId });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "PROMAN", providerExternalId: offerId });
  });
  it("captures one selected modal including summary, job and profile tabs", () => {
    const context = capture().acquisition.contexts![0]!;
    expect(context.text).toContain("6 Mois"); expect(context.text).toContain("Masterisation"); expect(context.text).toContain("De formation supérieure");
    expect(context.text).not.toMatch(/Wrong job|PARIS|100000|10 ans|ACCOUNT_PERSON|SecretSessionValue/);
    expect(context.html).not.toMatch(/wire:|x-data|token|cookie|bearer/iu);
  });
  it("preserves the exact heading and panel workplace", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title: "Technicien de deploiement informatique H/F" } });
    expect(canonical.location.value?.rawText).toBe("VALBONNE (06)");
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "VALBONNE (06)", role: "WORKPLACE" })]);
  });
  it("extracts explicit interim plus full-time with bounded provenance", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM", "FULL_TIME"]);
    expect(evidence.engagements[0]?.rawTerms).toEqual(["Intérim", "Rythme de travail: Temps plein"]);
  });
  it("does not infer full-time from interim or agency opening hours", async () => {
    expect((await project(page(pane.replace("Temps plein", "Non précisé")))).canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM"]);
  });
  it("uses explicit part-time when the selected source supplies it", async () => {
    expect((await project(page(pane.replace("Temps plein", "Temps partiel")))).canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM", "PART_TIME"]);
  });
  it("retains the complete bounded hourly salary range", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "13.74€ - 14.29€ / h", currency: "EUR", minimum: 13.74, maximum: 14.29, period: "HOUR" })]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 13.74, maximum: 14.29, currency: "EUR", period: "HOUR" } });
  });
  it("extracts bounded 2-3 years experience and keeps duration source-only", async () => {
    const { evidence } = await project();
    expect(evidence.experienceRequirements).toEqual([expect.objectContaining({ minimumYears: 2, maximumYears: 3, unit: "YEAR" })]);
    expect(capture().acquisition.contexts?.[0]?.text).toContain("6 Mois");
  });
  it("maps the explicit two-digit publication year to existing source date support", () => {
    expect(capture().observation.publishedAt).toEqual(new Date("2026-10-06T00:00:00Z"));
  });
  it("retains primary and secondary identifiers with separate types", async () => {
    const { evidence } = await project();
    expect(evidence.externalIdentifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: offerId, identifierType: "SOURCE_EXTERNAL_ID" }),
      expect.objectContaining({ value: "AIX71-MP1197787", identifierType: "PROMAN_REFERENCE" }),
    ]));
    expect(capture().observation.source.externalId).toBe(offerId);
  });
  it("does not interpret a differently formatted secondary reference as a primary ID conflict", async () => {
    const { evidence } = await project(page(pane.replace("REF AIX71-MP1197787", "REF AIX71-MPI197787")));
    expect(evidence.externalIdentifiers).toContainEqual(expect.objectContaining({ identifierType: "PROMAN_REFERENCE", value: "AIX71-MPI197787" }));
  });
  it("uses the displayed logo plus exact branch label, not generic dashboard branding", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: branch, role: "DISPLAYED_COMPANY" }), expect.objectContaining({ value: branch, role: "STAFFING_AGENCY" })]);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
    expect(canonical.organizationRelationships.some(item => item.role === "EMPLOYER" || item.role === "CLIENT")).toBe(false);
    const projection = await getRecruitingAgencyProjection(canonical, { findByNormalizedName: async () => [], append: async () => false });
    expect(projection.context.candidates).toEqual([expect.objectContaining({ name: branch, role: "STAFFING_AGENCY" })]);
  });
  it("does not classify a branch as staffing from brand alone without staffing evidence", async () => {
    const html = pane.replace('>Intérim</span>', '>CDI</span>').replace("réseau d'agences dédié au recrutement, en intérim", "réseau de services d'ingénierie");
    expect((await project(page(html))).evidence.organizations.some(item => item.role === "STAFFING_AGENCY")).toBe(false);
  });
  it("does not duplicate the brand when the branch label already includes PROMAN", async () => {
    expect((await project(page(pane.replace("AIX EXPERTISE 2", branch)))).evidence.organizations[0]?.value).toBe(branch);
  });
  it("retains future explicit named-client review evidence", async () => {
    const { evidence } = await project(page(pane.replace("Vos missions sont les suivantes", "Nous recrutons pour notre client ACME. Vos missions sont les suivantes")));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "ACME", role: "CLIENT" }));
  });
  it("excludes background cards, structured jobs, account text and arbitrary browser metadata from persisted acquisition", () => {
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ pageUrl: promanUrl + "&token=URL_SECRET#ACCOUNT_PERSON", pageTitle: "ACCOUNT_PERSON", visibleText: outside,
      html: page() + '<script type="application/ld+json">{"@type":"JobPosting","title":"Private wrong job","employmentType":"PART_TIME"}</script><script>Bearer AUTH_SECRET</script><form>LOGIN_SECRET<input value="PASSWORD_SECRET"></form>',
      browserMetadata: { cookies: "COOKIE_SECRET", bearer: "BEARER_SECRET", account: "ACCOUNT_PERSON" }, capturedAt: "2026-10-23T12:00:00Z" }, "acq");
    const serialized = JSON.stringify(acquisition);
    expect(serialized).not.toMatch(/SECRET|ACCOUNT_PERSON|Wrong job|Private wrong job|SecretSessionValue/);
    expect(acquisition.sourceUrl).toBe(promanUrl);
    expect(acquisition.content.structuredPayload).toBeUndefined();
  });
  it("redacts private dashboard data even when no modal can be bounded", () => {
    const { acquisition, observation } = capture(outside);
    expect(acquisition.contexts).toBeUndefined();
    expect(JSON.stringify(observation)).not.toMatch(/ACCOUNT_PERSON|SecretSessionValue|Wrong job|100000/);
  });
  it("reconstructs an old full-page capture without mutating it or reading stale mapped facts", async () => {
    const { observation } = capture();
    const old = { ...observation, title: "Wrong job", displayedCompanyName: "Wrong employer", salaryText: "100000 EUR / YEAR", metadata: { acquisition: { html: page() } }, rawContent: outside };
    const before = structuredClone(old), evidence = await extractor.extract(old);
    expect(evidence.vacancyTitles[0]?.value).toBe("Technicien de deploiement informatique H/F");
    expect(evidence.compensations[0]?.minimum).toBe(13.74); expect(old).toEqual(before);
  });
  it.each([
    pane.replace("mp1197787-", "mp1197788-"),
    pane.replace('class="panel-container', 'data-offre-id="1197788" class="panel-container'),
    pane.replace("REF AIX71-MP1197787", "REF AIX71-MP1197787</span><span>REF AIX71-MP1197788"),
  ])("fails closed on inconsistent values of the same identifier type", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(offerId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each([
    "", pane + pane,
    `<div style="display: none">${pane}</div>`,
    pane.replace('role="dialog"', 'hidden role="dialog"'),
    pane.replace('aria-modal="true"', 'aria-modal="false"'),
    pane.replace('role="dialog"', 'role="region"'),
    pane.replace('role="dialog"', 'aria-hidden="true" role="dialog"'),
    pane.replace('role="dialog"', 'style="display: none" role="dialog"'),
    pane.replace("popin-header-nuage", "unknown"),
    pane.replace("Mission proposée par", "Unknown agency"),
    pane.replace("activeTab === 'poste'", "activeTab === 'other'"),
    pane.replace(/https:\/\/www.proman-emploi.fr\/mp1197787-[^"']+/u, "/apply"),
  ])("fails closed on absent, ambiguous, closed or unsupported panels", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.contexts).toBeUndefined();
    const stale = { ...observation, title: "Wrong job", locationText: "PARIS (75)", salaryText: "100000 EUR / YEAR", contractText: "FULL_TIME", displayedCompanyName: "Wrong employer" };
    const evidence = await extractor.extract(stale);
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.compensations, evidence.engagements, evidence.organizations, evidence.experienceRequirements]) expect(items).toEqual([]);
  });
  it("accepts a closed unrelated modal alongside one uniquely active vacancy", () => {
    const closed = pane.replace('role="dialog"', 'aria-hidden="true" role="dialog"');
    expect(capture(page(pane + closed)).acquisition.contexts).toHaveLength(1);
  });
  it.each([
    "https://mon-espace.proman-emploi.fr/dashboard", promanUrl + "&offre_id=1197788", promanUrl.replace("1197787", "abc"),
    promanUrl.replace("/dashboard", "/account"), promanUrl.replace("mon-espace.proman-emploi.fr", "www.proman-emploi.fr"), promanUrl.replace("mon-espace.proman-emploi.fr", "mon-espace.proman-emploi.fr.evil.test"),
  ])("does not recognize unsupported or ambiguous primary routes", url => {
    expect(capture(page(), url).acquisition.externalId).toBeUndefined();
  });
  it.each(["14.29€ - 13.74€ / h", "xx€ - 14.29€ / h", "13.74€ - xx€ / h"])("rejects malformed salary without falling back to the dashboard", async salary => {
    expect((await project(page(pane.replace("13.74€ - 14.29€ / h", salary)))).canonical.compensation.status).toBe("UNKNOWN");
  });
  it("attaches selected-context provenance to projected evidence", async () => {
    const { evidence } = await project();
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.compensations, ...evidence.engagements, ...evidence.organizations, ...evidence.experienceRequirements]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it("rejects conflicting explicitly supplied primary identity", () => {
    expect(new PromanSelectedVacancyContextLocator().locate({ providerKey: "PROMAN", sourceUrl: promanUrl, externalId: "1197788", html: page() })).toBeUndefined();
  });
  it("validates the panel-local favorite action when the public link is absent", () => {
    const html = pane.replace(/https:\/\/www.proman-emploi.fr\/mp1197787-[^"']+/u, "/apply").replace('class="panel-container', `wire:click="toggleJobFavorite(0, 1197787, '')" class="panel-container`);
    expect(capture(page(html)).acquisition.contexts).toHaveLength(1);
    expect(capture(page(html.replace("0, 1197787,", "0, 1197788,"))).acquisition.contexts).toBeUndefined();
  });
  it("does not accept an invalid calendar publication date", () => {
    expect(capture(page(pane.replace("Publiée le 06/10/26", "Publiée le 31/02/26"))).observation.publishedAt).toBeUndefined();
  });
  it("does not persist authentication data in observations or occurrence URLs, and ignores background-only changes for recapture", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const payload = { pageUrl: promanUrl + "&session=URL_SECRET#ACCOUNT_PERSON", pageTitle: "ACCOUNT_PERSON", visibleText: "ACCOUNT_PERSON COOKIE_SECRET",
        html: page() + '<script>SESSION_SECRET</script><form>PASSWORD_SECRET</form>', browserMetadata: { bearer: "BEARER_SECRET" }, capturedAt: "2026-10-23T12:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: payload.html.replaceAll("ACCOUNT_PERSON", "OTHER_ACCOUNT"), capturedAt: "2026-10-23T12:01:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      const persisted = JSON.stringify([db.prepare("SELECT * FROM source_observations").all(), db.prepare("SELECT * FROM capture_occurrences").all(), db.prepare("SELECT * FROM canonical_vacancies").all()]);
      expect(persisted).not.toMatch(/SECRET|ACCOUNT_PERSON|OTHER_ACCOUNT|Wrong job|SecretSessionValue/);
      expect(db.prepare("SELECT captured_url FROM capture_occurrences").all()).toEqual([{ captured_url: promanUrl }, { captured_url: promanUrl }]);
    } finally { db.close(); }
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: promanUrl, pageTitle: "PROMAN", html: page(), visibleText: "PROMAN vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("Vos missions sont les suivantes", "Vos missions principales sont les suivantes")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("PROMAN AIX EXPERTISE 2");
      const before = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const confirmed = await workflow.confirmVacancyRecruitingAgency({ canonicalVacancyId: canonicalId, candidateId: candidate.candidateId });
      expect(confirmed.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(confirmed.employer.status).toBe("UNRESOLVED");
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      const confirmedAgain = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-22T12:03:30Z" });
      expect(confirmedAgain.capture.observationId).toBe(first.capture.observationId);
      const sameReview = await workflow.getVacancyReview(canonicalId);
      expect(sameReview.agencyContext?.known[0]?.source).toBe("USER_CONFIRMED");
      expect(sameReview.agencyContext?.candidates).toEqual([]);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 1 });
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: promanUrl.replace(offerId, "1197788"), html: page().replaceAll(offerId, "1197788"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
