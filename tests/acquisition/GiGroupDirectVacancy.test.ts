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
const offerId = "85929";
const giUrl = "https://fr.gigroup.com/detail-offre-emploi/strasbourg-bas-rhin-technicien-de-maintenance-h-f/85929/";
const branch = "Gi Group SpA";
const pane = readFileSync("tests/fixtures/giGroupDirectVacancy.html", "utf8");
const outside = '<nav>Gi Group marketing Other role H/F PARIS CDI 100000 EUR / YEAR 10 ans minimum Wrong Agency recrute</nav><footer>Unrelated company</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
function postingPatch(html: string, patch: (posting: Record<string, unknown>) => Record<string, unknown>) {
  return html.replace(/(<script[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/giu, (full, open: string, raw: string, close: string) => {
    const posting = JSON.parse(raw) as Record<string, unknown>;
    return posting["@type"] === "JobPosting" ? open + JSON.stringify(patch(posting)) + close : full;
  });
}
const salary = (value: string) => page(pane.replaceAll("2300 € à 2800 € bruts (base 35 heures)", value));
function capture(html = page(), pageUrl = giUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Gi Group",
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
describe("Gi Group direct vacancy", () => {
  it("recognizes the French provider and numeric route ID", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "gigroup.com", externalId: offerId });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "GI_GROUP", providerExternalId: offerId });
    expect(capture(page(), giUrl + "?utm_source=test#details").acquisition.externalId).toBe(offerId);
  });
  it("bounds the current detail column and excludes print duplicates, SEO, navigation, sidebar and marketing", () => {
    const context = capture().acquisition.contexts![0]!;
    expect(context.text).not.toMatch(/Offres similaires|Champigneulles|Montataire|Saint-Quentin-Fallavier|La Rochelle|Cergy|Wrong Agency|100000|partenaire stratégique mondial|400 collaborateurs|Consulter toutes les offres/);
    expect(context.html).not.toMatch(/ggp-job-detail-sidebar|printable|brxe-post-title|partenaire stratégique mondial/);
    expect(context.text).toContain("Permis B manuel indispensable");
  });
  it("prefers the actual vacancy title over the SEO title and matched JSON-LD title", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role.value?.title).toBe("Technicien de Maintenance Itinérant H/F");
    expect(evidence.vacancyTitles).toEqual([expect.objectContaining({ value: "Technicien de Maintenance Itinérant H/F" })]);
  });
  it("uses bounded Strasbourg/Bas-Rhin workplace instead of similar-job locations", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.location.value?.rawText).toBe("Strasbourg, Bas-Rhin");
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "Strasbourg, Bas-Rhin", role: "WORKPLACE" })]);
  });
  it("extracts explicit CDI and full-time with bounded provenance", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "FULL_TIME"]);
    expect(evidence.engagements[0]?.rawTerms).toEqual(["Cdi", "CDI", "Temps plein"]);
  });
  it("does not infer full-time from CDI or weekly hours", async () => {
    expect((await project(page(pane.replace("Temps plein", "Horaires non précisés")))).canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
  });
  it("does not infer CDI from full-time", async () => {
    const html = pane.replaceAll("Cdi", "Non précisé").replaceAll(": CDI", ": Non précisé");
    expect((await project(page(html))).canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
  });
  it("preserves contradictory bounded contract terms", async () => {
    const { canonical } = await project(page(pane.replace("Cdi", "Cdd")));
    expect(canonical.engagement.status).toBe("CONFLICTED");
  });
  it.each(["2300 € à 2800 €", "2 300 € à 2 800 €", "2300€ - 2800€", "2\u00a0300 € à 2\u00a0800 €", "2300,00 € à 2800,00 €"])("parses the complete salary range without inferring a period: %s", async rawText => {
    const { evidence, canonical } = await project(salary(rawText));
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText, currency: "EUR", minimum: 2300, maximum: 2800 })]);
    expect(Object.hasOwn(evidence.compensations[0]!, "period")).toBe(false);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 2300, maximum: 2800, currency: "EUR" } });
    expect(canonical.compensation.value?.period).toBeUndefined();
  });
  it("retains bruts/base 35 heures literally without interpreting hours as a salary period", async () => {
    const { evidence } = await project();
    expect(evidence.compensations[0]?.rawText).toBe("2300 € à 2800 € bruts (base 35 heures)");
    expect(evidence.compensations[0]?.period).toBeUndefined();
    expect(capture().acquisition.contexts?.[0]?.text).toContain("37 heures (dont 8 heures supplémentaires)");
  });
  it("does not consume nearby benefit amounts or benefit periods", async () => {
    const html = pane.replace("Participation + intéressement : 1 mois de salaire", "Prime de 500 € par mois + Participation : 1 mois de salaire");
    const { evidence, canonical } = await project(page(html));
    expect(evidence.compensations).toHaveLength(1); expect(evidence.compensations[0]?.maximum).toBe(2800);
    expect(canonical.compensation.value?.period).toBeUndefined();
  });
  it.each(["2800 € à 2300 €", "23 00 € à 2800 €", "2300 € à xxxx €", "Salaire à négocier"])("rejects malformed salary without opaque JSON-LD or page-wide fallback", async raw => {
    expect((await project(salary(raw))).canonical.compensation.status).toBe("UNKNOWN");
  });
  it("uses an explicit visible salary period", async () => {
    expect((await project(salary("2300 € à 2800 € bruts / mois (base 35 heures)"))).canonical.compensation.value?.period).toBe("MONTH");
  });
  it("uses an explicit matched structured period only with the same currency and full range", async () => {
    const html = postingPatch(pane, posting => ({ ...posting, baseSalary: { currency: "EUR", value: { minValue: 2300, maxValue: 2800, unitText: "MONTH" } } }));
    const { evidence, canonical } = await project(page(html));
    expect(evidence.compensations).toHaveLength(2);
    expect(evidence.compensations[1]).toMatchObject({ period: "MONTH", rawText: "JobPosting[85929].baseSalary: EUR 2300–2800 / MONTH", provenance: { extractionMethod: "DIRECT_FIELD" } });
    expect(canonical.compensation.value?.period).toBe("MONTH");
  });
  it.each(["USD", "EUR"])("does not attach a structured period to mismatching salary evidence", async currency => {
    const html = postingPatch(pane, posting => ({ ...posting, baseSalary: { currency, value: { minValue: 9000, maxValue: 10000, unitText: "MONTH" } } }));
    expect((await project(page(html))).canonical.compensation.value?.period).toBeUndefined();
  });
  it("does not let unrelated structured salary supply a period", async () => {
    const html = pane + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"99999","baseSalary":{"currency":"EUR","value":{"minValue":2300,"maxValue":2800,"unitText":"MONTH"}}}</script>';
    expect((await project(page(html))).canonical.compensation.value?.period).toBeUndefined();
  });
  it("preserves conflicting explicit visible and structured salary periods", async () => {
    const html = postingPatch(pane.replaceAll("2300 € à 2800 € bruts (base 35 heures)", "2300 € à 2800 € / an"), posting => ({ ...posting, baseSalary: { currency: "EUR", value: { minValue: 2300, maxValue: 2800, unitText: "MONTH" } } }));
    expect((await project(page(html))).canonical.compensation.status).toBe("CONFLICTED");
  });
  it("does not borrow a unit from an otherwise equal foreign-currency structured range", async () => {
    const html = postingPatch(pane, posting => ({ ...posting, baseSalary: { currency: "USD", value: { minValue: 2300, maxValue: 2800, unitText: "MONTH" } } }));
    expect((await project(page(html))).canonical.compensation.value?.period).toBeUndefined();
  });
  it("retains start date, weekly hours and benefits in source context, and maps publication", () => {
    const { observation, acquisition } = capture();
    expect(observation.publishedAt).toEqual(new Date("2026-10-21T00:00:00Z"));
    expect(acquisition.contexts?.[0]?.text).toContain("Dès que possible");
    expect(acquisition.contexts?.[0]?.text).toContain("37 heures (dont 8 heures supplémentaires)");
    expect(acquisition.contexts?.[0]?.text).toContain("Mutuelle + voiture de service");
  });
  it("classifies matched Gi Group SpA as staffing and suppresses employer confirmation", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: branch, role: "DISPLAYED_COMPANY" }), expect.objectContaining({ value: branch, role: "STAFFING_AGENCY" })]);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
    expect(canonical.organizationRelationships.some(item => item.role === "EMPLOYER" || item.role === "CLIENT")).toBe(false);
    const projection = await getRecruitingAgencyProjection(canonical, { findByNormalizedName: async () => [], append: async () => false });
    expect(projection.context.candidates).toEqual([expect.objectContaining({ name: branch, role: "STAFFING_AGENCY" })]);
  });
  it("supports provider staffing semantics without requiring a named client or creating memory automatically", async () => {
    const { evidence } = await project(page(pane.replace("Nous recherchons pour l’un de nos clients,", "Nous recherchons actuellement")));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: branch, role: "STAFFING_AGENCY" }));
  });
  it("does not classify a different structured hiring organization as the provider's staffing business", async () => {
    const { evidence } = await project(page(postingPatch(pane, posting => ({ ...posting, hiringOrganization: { name: "ACME" } }))));
    expect(evidence.organizations.some(item => item.value === "ACME" && item.role === "STAFFING_AGENCY")).toBe(false);
  });
  it("retains explicit future named-client evidence", async () => {
    const { evidence } = await project(page(pane.replace("Nous recherchons pour l’un de nos clients,", "Nous recrutons pour notre client ACME. Nous recherchons")));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "ACME", role: "CLIENT" }));
  });
  it("does not let stronger-looking sidebar text create title, location, pay, experience or organizations", async () => {
    const html = pane.replace("Offres similaires", "Offres similaires</h3><div class='p_hitem'><div class='p_hitem_title'>Code de référence:</div><div class='p_hitem_value'>99999</div></div><h3>Other role H/F PARIS CDI 100000 EUR / YEAR 10 ans minimum Wrong Agency recrute");
    const { evidence } = await project(page(html));
    expect(evidence.vacancyTitles[0]?.value).toBe("Technicien de Maintenance Itinérant H/F");
    expect(evidence.locations).toHaveLength(1); expect(evidence.compensations[0]?.minimum).toBe(2300);
    expect(evidence.experienceRequirements).toEqual([]); expect(evidence.organizations.map(item => item.value)).toEqual([branch, branch]);
  });
  it.each([
    pane.replace('rel="canonical" href="' + giUrl, 'rel="canonical" href="' + giUrl.replace(offerId, "85930")),
    pane.replace('class="ggp-job-detail col-md-8', 'data-offer-id="85930" class="ggp-job-detail col-md-8'),
    pane.replace('viewoffer/85929', 'viewoffer/85930'),
    pane.replace('>85929</div>', '>85930</div>'),
    postingPatch(pane, posting => ({ ...posting, identifier: { value: "85930" } })),
  ])("fails closed on explicit conflicting current vacancy IDs while retaining URL identity", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(offerId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each([
    "", pane + pane,
    pane.replace('class="ggp-job-detail col-md-8', 'class="unknown col-md-8'),
    pane.replace("Technicien de Maintenance Itinérant H/F </b>", "Unknown content </b>"),
    pane.replace("Votre profil</b>", "Unknown section</b>"),
    pane.replace("Vos missions</b>", "Unknown section</b>"),
  ])("fails closed for missing or ambiguous boundaries and strips stale source fields immutably", async html => {
    const { observation } = capture(page(html));
    const stale = { ...observation, title: "Wrong role", locationText: "Cergy", displayedCompanyName: "Gi Group SpA", contractText: "FULL_TIME", salaryText: "100000 EUR / YEAR" };
    const before = structuredClone(stale), evidence = await extractor.extract(stale);
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.compensations, evidence.engagements]) expect(items).toEqual([]);
    expect(stale).toEqual(before);
  });
  it.each(["https://fr.gigroup.com/offres-emploi/", giUrl.replace("85929", "abc"), giUrl.replace("fr.gigroup.com", "www.gigroup.com"), giUrl.replace("fr.gigroup.com", "fr.gigroup.com.evil.test")])("rejects unsupported ID routes/hosts", url => {
    expect(capture(page(), url).acquisition.externalId).toBeUndefined();
  });
  it("ignores ambiguous matched structured postings and does not invent the legal organization name", async () => {
    const script = pane.match(/<script[\s\S]*?<\/script>/iu)![0];
    const { evidence, canonical } = await project(page(pane + script));
    expect(evidence.organizations).toEqual([]); expect(canonical.compensation.value?.period).toBeUndefined();
  });
  it("reprocesses old full-page captures without changing immutable source content", async () => {
    const { observation } = capture();
    const old = { ...observation, title: "Technicien de maintenance -h/f", displayedCompanyName: "Gi Group SpA", contractText: "FULL_TIME", rawContent: outside, metadata: { acquisition: { html: page() } } };
    const before = structuredClone(old), evidence = await extractor.extract(old);
    expect(evidence.vacancyTitles[0]?.value).toBe("Technicien de Maintenance Itinérant H/F");
    expect(evidence.compensations[0]?.period).toBeUndefined(); expect(old).toEqual(before);
  });
  it("does not invent an organization from unmatched structured data", async () => {
    const html = pane.replace(/<script[\s\S]*?<\/script>/giu, "");
    expect((await project(page(html))).evidence.organizations).toEqual([]);
  });
  it("attaches normal bounded provenance to all projected provider facts", async () => {
    const { evidence } = await project();
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.compensations, ...evidence.engagements, ...evidence.organizations]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it("preserves recapture identity and supports human agency memory independently of employer assignments", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: giUrl, pageTitle: "Gi Group", html: page(), visibleText: "Gi Group vacancy", capturedAt: "2026-10-22T12:00:00Z" };
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
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page(pane.replace("Diagnostic de pannes", "Diagnostic des pannes")), capturedAt: "2026-10-22T12:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED");
      const candidate = review.agencyContext!.candidates[0]!;
      expect(candidate.name).toBe("Gi Group SpA");
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
      const later = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: giUrl.replace(offerId, "85930"), html: page().replaceAll(offerId, "85930"), capturedAt: "2026-10-22T12:04:00Z" });
      if (later.processing.status !== "PROCESSED") throw Error("Processing failed");
      const laterReview = await workflow.getVacancyReview(later.processing.canonicalVacancyId);
      expect(laterReview.agencyContext?.known[0]?.source).toBe("AGENCY_MEMORY");
      expect(laterReview.agencyContext?.candidates).toEqual([]);
      expect(laterReview.employer.status).toBe("UNRESOLVED");
    } finally { db.close(); }
  });
});
