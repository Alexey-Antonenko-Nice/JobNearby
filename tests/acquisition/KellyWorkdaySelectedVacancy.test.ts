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
import { KellySelectedVacancyContextLocator, kellyVacancyId } from "../../src/application/acquisition/KellyWorkdayVacancy.js";
const offerId = "JR100451";
const kellyUrl = "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Supervisor-Site_JR100451?jobFamilyGroup=2d970158a7eb1000bfa197af03f80000";
const pane = readFileSync("tests/fixtures/kellyWorkdaySelectedVacancy.html", "utf8");
const outside = '<nav>Corporate Careers Remote Other Company 200000 USD / YEAR</nav><footer>Remote</footer>';
const page = (job = pane) => outside + job + outside;
const extractor = createVacancyEvidenceExtractor();
const numericUrl = "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Talent-Supply-Chain-Consultant_14860?jobFamilyGroup=2d970158a7eb1000bfa197af03f80000";
const numericPane = readFileSync("tests/fixtures/kellyWorkdayNumericSelectedVacancy.html", "utf8");
async function numericProjection(html = numericPane) {
  const { acquisition, observation } = capture(html, numericUrl);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "numeric", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-23") },
  });
  return { acquisition, observation, evidence, canonical };
}
function editPane(html: string, edit: (selected: string) => string) {
  return html.replace(/<section\b[^>]*data-automation-id="jobDetails"[^>]*>[\s\S]*?<\/section>/iu, edit);
}
function capture(html = page(), pageUrl = kellyUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html, pageUrl, pageTitle: "Kelly",
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
describe("Kelly Workday corporate selected vacancy", () => {
  it.each([[kellyUrl, "JR100451"], [numericUrl, "14860"], [numericUrl.split("?")[0] + "/", "14860"]])("extracts the scoped route reference: %s", (url, id) => {
    expect(kellyVacancyId(url!)).toBe(id);
  });
  it("captures only the numeric selected pane and projects its title, workplace, mode, time and posting text", async () => {
    const { acquisition, evidence, canonical } = await numericProjection();
    expect(acquisition.externalId).toBe("14860");
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "KELLY_WORKDAY", providerExternalId: "14860" });
    expect(acquisition.contexts?.[0]?.text).toContain("Posted 2 Days Ago");
    expect(acquisition.contexts?.[0]?.text).not.toMatch(/JR100451|JR100418|JR100331|JR100414|14878|Supervisor Site|Site Supervisor|TSC Consultant|New Mexico|New Jersey|Arizona|Egypt|2 Locations/);
    expect(acquisition.contexts?.[0]?.html).not.toMatch(/similar-jobs-heading|JR100414|14878|Egypt|2 Locations/);
    expect(canonical.role.value?.title).toBe("Talent Supply Chain Consultant");
    expect(canonical.location.value?.rawText).toBe("United States-Texas-Remote");
    expect(canonical.workMode).toMatchObject({status:"RESOLVED",value:"REMOTE"});
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(evidence.externalIdentifiers).toEqual([expect.objectContaining({value:"14860"})]);
    expect(evidence.organizations.map(o=>[o.value,o.role])).toEqual([["Kelly","DISPLAYED_COMPANY"],["Kelly","EMPLOYER"]]);
  });
  it.each([
    'Our client is hiring a consultant.',
    'We are recruiting for our client ACME.',
    'This vacancy is an assignment with our client ACME.',
    'Temporary assignment with our client ACME.',
    'This is a temporary assignment with our client ACME.',
    'We have a staffing assignment with our client ACME.',
  ])("requires intermediary semantics at vacancy level: %s", async wording => {
    const { evidence } = await numericProjection(editPane(numericPane, selected => selected.replace('Together we change lives.', wording + ' Together we change lives.')));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({value:"Kelly",role:"STAFFING_AGENCY"}));
    expect(evidence.organizations.some(o=>o.role==="EMPLOYER")).toBe(false);
  });
  it.each([
    'The role is client-facing and works with clients and hiring managers.',
    'Manage temporary and contract talent.',
    'Perform recruitment and workforce services as our Talent Supply Chain Consultant.',
    'You will recruit talent for our clients and coordinate temporary assignments for our clients.',
    'As our consultant, you will recruit talent for our client accounts and liaise with hiring managers.',
    'You will coordinate a temporary assignment with our client and support hiring managers.',
  ])("does not mistake occupational duties for client-assignment evidence: %s", async duties => {
    const { evidence } = await numericProjection(editPane(numericPane, selected => selected.replace('Together we change lives.', duties + ' Together we change lives.')));
    expect(evidence.organizations.map(o=>o.role)).toEqual(["DISPLAYED_COMPANY","EMPLOYER"]);
  });
  it.each([
    editPane(numericPane, selected => selected.replace('>14860</dd>', '>14861</dd>')),
    editPane(numericPane, selected => selected.replace('>14860</dd>', '>JR100451</dd>')),
    editPane(numericPane, selected => selected.replace('/Talent-Supply-Chain-Consultant_14860/apply', '/Talent-Supply-Chain-Consultant_14861/apply')),
    editPane(numericPane, selected => selected.replace('/job/Talent-Supply-Chain-Consultant_14860', '/job/Talent-Supply-Chain-Consultant_JR100451')),
    numericPane + '<script type="application/ld+json">{"@type":"JobPosting","identifier":14861,"url":"' + numericUrl + '"}</script>',
    numericPane + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"14861","url":"' + numericUrl + '"}</script>',
    numericPane + '<script type="application/ld+json">{"@type":"JobPosting","identifier":14860.5,"url":"' + numericUrl + '"}</script>',
  ])("fails closed on a conflicting numeric pane/link/structured reference", async html => {
    const { acquisition, evidence } = await numericProjection(html);
    expect(acquisition.externalId).toBe("14860"); expect(acquisition.contexts).toBeUndefined();
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.organizations).toEqual([]);
  });
  it.each([
    numericUrl.replace('kellyservices.wd503.myworkdayjobs.com','airproducts.wd5.myworkdayjobs.com'),
    numericUrl.replace('corporatecareers-kellyservices-com','clientassignments'),
    numericUrl.replace('/en-US/','/fr-FR/'),
    numericUrl.replace('/details/','/job/'),
    numericUrl.replace('_14860','_14860-extra'),
  ])("keeps numeric identity tenant/route-scoped: %s", url => {
    expect(kellyVacancyId(url)).toBeUndefined();
    expect(capture(numericPane,url).acquisition.externalId).toBeUndefined();
  });
  it("accepts matching numeric structured identity and ignores unrelated neighboring structured postings", async () => {
    const html = numericPane + '<script type="application/ld+json">[{"@type":"JobPosting","identifier":{"value":14860},"url":"' + numericUrl + '"},{"@type":"JobPosting","identifier":"JR100451","url":"/en-US/corporatecareers-kellyservices-com/job/Supervisor-Site_JR100451"}]</script>';
    expect((await numericProjection(html)).acquisition.contexts?.[0]?.providerExternalId).toBe("14860");
  });
  it.each([
    numericPane.replace('aria-label="Similar jobs"', 'aria-label="Unknown recommendations"'),
    numericPane.replace('data-automation-id="similar-jobs-heading"', 'data-automation-id="unidentified-heading"'),
    numericPane.replace('Similar Jobs (5)', '<h3 data-automation-id="similar-jobs-heading">Duplicate heading</h3>'),
    numericPane.replace('Similar Jobs (5)', '<h2 data-automation-id="jobPostingHeader">Conflicting selected title</h2>'),
    numericPane.replace('Similar Jobs (5)', '<div data-automation-id="requisitionId">Conflicting selected reference</div>'),
    numericPane.replace(/(<section\b[^>]*data-automation-id="jobDetails"[^>]*>)/u, '$1<div data-automation-id="locations"><dl><dt>locations</dt><dd>Wrong selected workplace</dd></dl></div>'),
  ])("does not relax primary-field ambiguity or strip an unvalidated recommendations section", async html => {
    const { acquisition, evidence } = await numericProjection(html);
    expect(acquisition.contexts).toBeUndefined(); expect(evidence.vacancyTitles).toEqual([]);
  });
  it("recognizes the scoped host, corporate route and no-hyphen requisition ID", () => {
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "kellyservices.wd503.myworkdayjobs.com", externalId: offerId });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "KELLY_WORKDAY", providerExternalId: offerId });
    expect(capture(page(), kellyUrl + "&utm_source=test#details").acquisition.externalId).toBe(offerId);
  });
  it("bounds only the selected right-side detail pane", () => {
    const context = capture().acquisition.contexts![0]!;
    expect(context.html).not.toMatch(/jobSearchPage|headerTitle|Talent Supply Chain Consultant|TSC Consultant/);
    expect(context.text).not.toMatch(/Corporate|Texas|Arizona|New Jersey|Remote|Other Company/);
    expect(context.text).toContain("Posted Today"); expect(context.text).toContain("JR100451");
  });
  it("projects the selected title and labeled workplace, never a requisition as location", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.role.value?.title).toBe("Supervisor Site");
    expect(canonical.location.value?.rawText).toBe("United States-New Mexico-Customer On-site");
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "United States-New Mexico-Customer On-site", role: "WORKPLACE" })]);
    expect(evidence.locations.some(item => item.value === offerId)).toBe(false);
  });
  it("maps selected In Person to ON_SITE despite neighboring Remote cards", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.workMode).toMatchObject({ status: "RESOLVED", value: "ON_SITE" });
    expect(evidence.workModes).toEqual([expect.objectContaining({ value: "ON_SITE" })]);
  });
  it("uses explicit Full time without inventing permanence", async () => {
    const { canonical, evidence } = await project();
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(evidence.engagements[0]?.rawTerms).toEqual(["Full time"]);
  });
  it("can use a selected Remote or part-time value without reading neighboring card values", async () => {
    const html = editPane(pane, selected => selected.replace('>In Person</dd>', '>Remote</dd>').replace('>Full time</dd>', '>Part time</dd>'));
    const { canonical } = await project(page(html));
    expect(canonical.workMode.value).toBe("REMOTE"); expect(canonical.engagement.value?.normalizedTerms).toEqual(["PART_TIME"]);
  });
  it("does not infer time type or mode from description or left cards when the selected labels are absent", async () => {
    const html = editPane(pane, selected => selected.replace('data-automation-id="time"', 'data-automation-id="otherTime"').replace('data-automation-id="remoteType"', 'data-automation-id="otherRemote"'));
    const { canonical } = await project(page(html));
    expect(canonical.engagement.status).toBe("UNKNOWN"); expect(canonical.workMode.status).toBe("UNKNOWN");
  });
  it("retains Posted Today without inventing an absolute publication date", () => {
    const { observation, acquisition } = capture();
    expect(observation.publishedAt).toBeUndefined(); expect(acquisition.contexts?.[0]?.text).toContain("Posted Today");
  });
  it("extracts the explicit selected annual US salary range", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.compensations).toEqual([expect.objectContaining({ currency: "USD", minimum: 61575, maximum: 82100, period: "YEAR" })]);
    expect(evidence.compensations[0]?.rawText).toContain("annual base pay"); expect(evidence.compensations[0]?.rawText).toContain("$61,575.00 - $82,100.00");
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { currency: "USD", minimum: 61575, maximum: 82100, period: "YEAR" } });
  });
  it("does not infer annual salary without the selected explicit annual statement", async () => {
    expect((await project(page(editPane(pane, selected => selected.replace("The annual base pay for this position is listed below.", "Compensation is discussed during interview."))))).canonical.compensation.status).toBe("UNKNOWN");
  });
  it.each(["$82,100.00 - $61,575.00", "$61,57.00 - $82,100.00", "$61,575.00 - $82,100.000"])("rejects malformed selected compensation: %s", async raw => {
    expect((await project(page(editPane(pane, selected => selected.replace("$61,575.00 - $82,100.00", raw))))).canonical.compensation.status).toBe("UNKNOWN");
  });
  it("does not infer USD from the dollar sign for an unsupported country", async () => {
    expect((await project(page(editPane(pane, selected => selected.replace("United States-New Mexico-Customer On-site", "Canada-Ontario-Onsite"))))).canonical.compensation.status).toBe("UNKNOWN");
  });
  it("uses Kelly's first-person identity and direct-employer source evidence, not Corporate", async () => {
    const { canonical, evidence } = await project();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Kelly", role: "DISPLAYED_COMPANY" }), expect.objectContaining({ value: "Kelly", role: "EMPLOYER" })]);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBe("Kelly");
    const review = await getRecruitingAgencyProjection(canonical, { findByNormalizedName: async () => [], append: async () => false });
    expect(review.context.candidates).toEqual([]); expect(review.context.known).toEqual([]);
  });
  it("does not invent Kelly Services or use the tenant label when explicit Kelly identity is absent", async () => {
    const { evidence, canonical } = await project(page(editPane(pane, selected => selected.replaceAll("Kelly is", "Our company is"))));
    expect(evidence.organizations).toEqual([]); expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
  });
  it("does not mistake ordinary client communication for a staffing assignment", async () => {
    expect((await project()).evidence.organizations.some(item => ["STAFFING_AGENCY", "RECRUITER", "RECRUITMENT_AGENCY"].includes(item.role))).toBe(false);
  });
  it("honors explicit client-assignment wording instead of applying corporate-employer semantics blindly", async () => {
    const html = editPane(pane, selected => selected.replace("Together we change lives.", "We are recruiting for our client ACME."));
    const { evidence, canonical } = await project(page(html));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Kelly", role: "STAFFING_AGENCY" }));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "ACME", role: "CLIENT" }));
    expect(evidence.organizations.some(item => item.role === "EMPLOYER")).toBe(false);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBeNull();
  });
  it("does not mistake providing client services for an intermediary employment relationship", async () => {
    const html = editPane(pane, selected => selected.replace("Together we change lives.", "We provide technical support for our client ACME."));
    const { evidence, canonical } = await project(page(html));
    expect(evidence.organizations.map(item => item.role)).toEqual(["DISPLAYED_COMPANY", "EMPLOYER"]);
    expect(employerConfirmationCandidate(canonical.organizationRelationships)).toBe("Kelly");
  });
  it("keeps only the selected requisition in external identifier evidence", async () => {
    expect((await project()).evidence.externalIdentifiers).toEqual([expect.objectContaining({ value: offerId, identifierType: "SOURCE_EXTERNAL_ID" })]);
  });
  it("ignores neighboring cards and page-wide JSON-LD/API-like result state", async () => {
    const html = page() + '<script type="application/ld+json">{"@type":"JobPosting","title":"Wrong role","employmentType":"PART_TIME"}</script><script>window.searchResults=[{jobId:"JR999999",remoteType:"Remote",company:"Staffing Agency"}]</script>';
    const { canonical, evidence } = await project(html);
    expect(canonical.role.value?.title).toBe("Supervisor Site"); expect(canonical.workMode.value).toBe("ON_SITE");
    expect(evidence.organizations.map(item => item.value)).toEqual(["Kelly", "Kelly"]);
  });
  it.each([
    editPane(pane, selected => selected.replace('>JR100451</dd>', '>JR100452</dd>')),
    editPane(pane, selected => selected.replace('/Supervisor-Site_JR100451/apply', '/Supervisor-Site_JR100452/apply')),
    editPane(pane, selected => selected.replace('/job/Supervisor-Site_JR100451', '/job/Supervisor-Site_JR100452')),
    pane + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"JR100452","url":"' + kellyUrl + '"}</script>',
  ])("fails closed on conflicting current IDs while retaining the route ID", async html => {
    const { acquisition, observation } = capture(page(html));
    expect(acquisition.externalId).toBe(offerId); expect(acquisition.contexts).toBeUndefined();
    expect((await extractor.extract(observation)).vacancyTitles).toEqual([]);
  });
  it.each([
    "", pane + pane,
    editPane(pane, selected => selected.replace('data-automation-id="jobDetails"', 'data-automation-id="unknownDetails"')),
    editPane(pane, selected => selected.replace('data-automation-id="jobPostingHeader"', 'data-automation-id="unknownHeader"')),
    editPane(pane, selected => selected.replace('data-automation-id="jobPostingDescription"', 'data-automation-id="unknownDescription"')),
    editPane(pane, selected => selected.replace('data-automation-id="locations"', 'data-automation-id="unknownLocation"')),
    editPane(pane, selected => selected.replace('data-automation-id="requisitionId"', 'data-automation-id="unknownReference"')),
    editPane(pane, selected => selected.replace('data-automation-id="adventureButton"', 'data-automation-id="unknownAction"')),
    editPane(pane, selected => selected.replace('>United States-New Mexico-Customer On-site</dd>', '>JR100451</dd>')),
    editPane(pane, selected => selected.replace('data-automation-id="jobDetails"', 'aria-hidden="true" data-automation-id="jobDetails"')),
  ])("fails closed on missing, ambiguous or unsafe detail panes and strips old mapped fields", async html => {
    const { observation, acquisition } = capture(page(html));
    expect(acquisition.contexts).toBeUndefined(); expect(acquisition.structuredFields).toBeUndefined();
    const stale = { ...observation, title: "Wrong role", locationText: "JR100451", displayedCompanyName: "Corporate", contractText: "Full time", salaryText: "200000 USD / YEAR" };
    const before = structuredClone(stale), evidence = await extractor.extract(stale);
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.engagements, evidence.workModes, evidence.compensations]) expect(items).toEqual([]);
    expect(stale).toEqual(before);
  });
  it.each([
    kellyUrl.replace("corporatecareers-kellyservices-com", "clientassignments"),
    kellyUrl.replace("/details/Supervisor-Site_JR100451", "/jobs"),
    kellyUrl.replace("JR100451", "unknown"),
    kellyUrl.replace("kellyservices.wd503.myworkdayjobs.com", "kellyservices.wd503.myworkdayjobs.com.evil.test"),
  ])("rejects unsupported Kelly tenants/routes/hosts without global role inference", url => {
    expect(capture(page(), url).acquisition.externalId).toBeUndefined();
  });
  it("revalidates old whole-page observations and leaves immutable source data unchanged", async () => {
    const { observation } = capture();
    const old = { ...observation, title: "Supervisor Site", locationText: "JR100451", displayedCompanyName: "Corporate", rawContent: outside, metadata: { acquisition: { html: page() } } };
    const before = structuredClone(old), evidence = await extractor.extract(old);
    expect(evidence.locations[0]?.value).toBe("United States-New Mexico-Customer On-site"); expect(evidence.workModes[0]?.value).toBe("ON_SITE"); expect(old).toEqual(before);
  });
  it("does not broaden the generic Workday ID grammar for other tenants", () => {
    const { acquisition } = capture(page(), kellyUrl.replace("kellyservices.wd503.myworkdayjobs.com", "airproducts.wd5.myworkdayjobs.com"));
    expect(acquisition.externalId).toBeUndefined();
  });
  it("ignores an unrelated structured search-result ID rather than treating it as the selected requisition", async () => {
    const html = page() + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"JR999999","url":"/en-US/corporatecareers-kellyservices-com/job/Other_JR999999","title":"Other role","employmentType":"PART_TIME"}</script>';
    const { canonical } = await project(html);
    expect(canonical.workMode.value).toBe("ON_SITE"); expect(canonical.role.value?.title).toBe("Supervisor Site");
  });
  it("validates a supplied primary ID instead of trusting a stale captured context", () => {
    expect(new KellySelectedVacancyContextLocator().locate({ providerKey: "KELLY_WORKDAY", sourceUrl: kellyUrl, externalId: "JR100452", html: page() })).toBeUndefined();
  });
  it("uses selected-pane provenance for normal projected evidence", async () => {
    const { evidence } = await project();
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.engagements, ...evidence.workModes, ...evidence.compensations, ...evidence.organizations]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it("preserves exact/changed recapture and requires human employer confirmation", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const clusters = new SqliteEmployerClusterRepository(db);
      const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
        employerClusterRepository: clusters, employerClusterWriter: clusters, assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
        agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
      const workflow = createVacancyReviewWorkflow(deps);
      const payload = { pageUrl: kellyUrl, pageTitle: "Corporate Careers", html: page(), visibleText: "Corporate Remote JR100451", capturedAt: "2026-10-23T08:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      const original = await deps.sourceObservationRepository.findById(first.capture.observationId);
      const assignments = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const review = await workflow.getVacancyReview(canonicalId);
      expect(review.employer.status).toBe("UNRESOLVED"); expect(review.employer.confirmationCandidate).toBe("Kelly");
      expect(review.agencyContext?.candidates).toEqual([]); expect(review.agencyContext?.known).toEqual([]);
      for (const capturedAt of ["2026-10-23T08:01:00Z", "2026-10-23T08:02:00Z"]) {
        const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt });
        expect(repeated.capture.observationId).toBe(first.capture.observationId); expect(repeated.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      }
      expect(await deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(assignments);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: editPane(page(), selected => selected.replace("Problem-solving abilities", "Excellent problem-solving abilities")), capturedAt: "2026-10-23T08:03:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
      expect(await deps.sourceObservationRepository.findById(first.capture.observationId)).toEqual(original);
      await workflow.confirmVacancyEmployer({ canonicalVacancyId: canonicalId, candidateName: "Kelly" });
      expect((await workflow.getVacancyReview(canonicalId)).employer.confirmationCandidate).toBeNull();
      const confirmedHistory = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-23T08:04:00Z" });
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(confirmedHistory);
      expect(db.prepare("SELECT COUNT(*) AS count FROM confirmed_organization_roles").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });

});
