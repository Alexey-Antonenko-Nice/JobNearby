import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createVacancyReviewWorkflow } from "../../../src/application/user/createVacancyReviewWorkflow.js";
import { createDatabase } from "../../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createBrowserCaptureServer } from "../../../src/infrastructure/http/createBrowserCaptureServer.js";
import { SqliteCanonicalVacancyRepository } from "../../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");
const westinghouseMeta = JSON.parse(fixture("linkedinSearchResultsWestinghouse.meta.json")) as { pageUrl: string };
const cases = {
  michael: { name: "Michael Page", id: "jn-102026-7118382", pageUrl: "https://www.michaelpage.fr/job-detail/technicienne-sav-france-fh/ref/jn-102026-7118382", html: fixture("michaelPageTechnicienVacancy.html") },
  expectra: { name: "Expectra", id: "826", pageUrl: "https://expectra.mc/offre-emploi/826-acheteur-approvisionneur-h-f", html: fixture("expectraMonacoVacancy.html") },
  hays: { name: "Hays", id: "8312", pageUrl: "https://m.hays.fr/careers/Job/Detail/8312?lang=fr", html: fixture("haysSelectedVacancy.html") },
  lhh: { name: "LHH", id: "2106003901", pageUrl: "https://www.lhh.com/fr-fr/offres-emploi?jobId=2106003901", html: fixture("lhhSelectedVacancy.html") },
  kelly: { name: "Kelly", id: "JR100451", pageUrl: "https://kellyservices.wd503.myworkdayjobs.com/en-US/corporatecareers-kellyservices-com/details/Supervisor-Site_JR100451", html: fixture("kellyWorkdaySelectedVacancy.html") },
  start: { name: "Start People", id: "9481983", pageUrl: "https://www.startpeople.fr/offre-emploi/strasbourg/coordinateur-technique-referent-atelier-h-f/9481983", html: fixture("startPeopleDirectVacancy.html") },
  linkedin: { name: "LinkedIn", id: "4446930208", pageUrl: westinghouseMeta.pageUrl, html: fixture("linkedinSearchResultsWestinghouse.html") },
  proman: { name: "PROMAN", id: "1197787", pageUrl: "https://mon-espace.proman-emploi.fr/dashboard?offre_id=1197787", html: fixture("promanSelectedVacancy.html") },
};
type Case = typeof cases.michael;
const payload = (c: Case, html = c.html) => ({ pageUrl: c.pageUrl, pageTitle: c.name, html, visibleText: "Captured vacancy page", capturedAt: "2026-10-24T10:00:00Z" });
const rows = (db: ReturnType<typeof createDatabase>, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
function setup() {
  const db = createDatabase(":memory:");
  const deps = {
    aliasRepository: new SqliteEmployerAliasEvidenceRepository(db), canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db), agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db),
    organizationRoleDecisionRepository: new SqliteVacancyOrganizationRoleDecisionRepository(db),
  };
  return { db, deps, runtime: createCaptureProcessingRuntime(db), workflow: createVacancyReviewWorkflow(deps) };
}
function acquisition(c: Case, html = c.html) {
  const captured = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload(c, html), "acquisition");
  return { captured, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(captured, "observation") };
}
const sideEffects = ["canonical_vacancies", "canonical_vacancy_source_observations", "canonical_vacancy_observation_claims",
  "canonical_vacancy_exact_identity_claims", "employer_clusters", "observation_cluster_assignments", "vacancy_organization_role_decisions"];

describe("capture acceptance and diagnostic identity contracts", () => {
  const rejected: Array<[string, Case, string]> = [
    ["Michael Page missing boundary", cases.michael, "<main>Vacancy unavailable</main>"],
    ["Expectra missing boundary", cases.expectra, cases.expectra.html.replace('class="band band-offer"', 'class="other"')],
    ["LHH legacy direct fallback is intentionally rejected", { ...cases.lhh, id: "2089206701", pageUrl: "https://www.lhh.com/fr-fr/offres-emploi/detail/2089206701" }, "<h1>Responsable maintenance H/F</h1><p>recherche pour son client</p>"],
    ["LHH selected pane missing", cases.lhh, "<main>Job search results</main>"],
    ["LHH ambiguous selected pane", cases.lhh, cases.lhh.html + cases.lhh.html.slice(cases.lhh.html.indexOf('<section class="JobSearch_line-break__923PP job_Details">'))],
    ["Hays ID without a vacancy", cases.hays, "<main>Vacancy unavailable</main>"],
    ["Hays associated reference conflict", cases.hays, cases.hays.html.replace('id="jd_reference">8312<', 'id="jd_reference">8313<')],
  ];
  it.each(rejected)("%s retains the route ID but cannot create vacancy or employer state", async (_label, c, html) => {
    const f = setup();
    try {
      const { captured } = acquisition(c, html);
      expect(captured.externalId).toBe(c.id);
      // LHH's legacy locator returns a context which the gate explicitly rejects.
      if (!c.pageUrl.includes("/detail/2089206701")) expect(captured.contexts).toBeUndefined();
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload(c, html));
      expect(result.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false });
      expect(result.processing).not.toHaveProperty("canonicalVacancyId");
      const stored = await f.deps.sourceObservationRepository.findById(result.capture.observationId);
      expect(stored?.source.externalId).toBe(c.id);
      for (const table of sideEffects) expect(rows(f.db, table)).toEqual([]);
      const again = await f.runtime.captureAndProcessBrowserVacancy(payload(c, html));
      expect(again.capture.observationId).toBe(result.capture.observationId);
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([result.capture.observationId])).toBe(2);
      for (const table of sideEffects) expect(rows(f.db, table)).toEqual([]);
    } finally { f.db.close(); }
  });

  it.each([cases.lhh, cases.expectra, { ...cases.hays, html: cases.hays.html.replace("Bienvenue chez HAYS !", "Bonjour !").replace(/nos 9 500 experts/u, "des experts") }])(
    "$name accepts valid vacancy evidence without a named employer", async c => {
      const f = setup();
      try {
        const result = await f.runtime.captureAndProcessBrowserVacancy(payload(c));
        expect(result.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, employerStatus: "UNRESOLVED_RECORD_CREATED" });
        if (result.processing.status !== "PROCESSED") throw Error("not processed");
        expect(rows(f.db, "employer_clusters")).toEqual([expect.objectContaining({ status: "UNRESOLVED" })]);
        expect(rows(f.db, "observation_cluster_assignments")).toEqual([expect.objectContaining({ status: "ACCEPTED" })]);
        expect(await f.workflow.getVacancyReview(result.processing.canonicalVacancyId)).toBeDefined();
      } finally { f.db.close(); }
    },
  );
});

describe("selected-only evidence contracts", () => {
  const poison = '<aside>POISONVACANCY H/F POISONCITY CDI 999999 EUR / YEAR Remote POISONCOMPANY recrute 9999999999</aside>';
  it.each([cases.michael, cases.lhh, cases.linkedin, cases.proman])("$name excludes unrelated vacancy facts across all evidence fields", async c => {
    const { captured: base, observation: original } = acquisition(c);
    const { captured, observation } = acquisition(c, `${poison}${c.html}${poison}`);
    expect(base.contexts?.[0]).toBeDefined();
    expect(captured.contexts?.[0]?.text).toBe(base.contexts?.[0]?.text);
    const extractor = createVacancyEvidenceExtractor();
    const before = structuredClone(observation);
    const baselineEvidence = await extractor.extract(original);
    const evidence = await extractor.extract(observation);
    expect(evidence).toEqual(baselineEvidence);
    expect(JSON.stringify({ titles: evidence.vacancyTitles, locations: evidence.locations, compensation: evidence.compensations,
      engagements: evidence.engagements, workModes: evidence.workModes, organizations: evidence.organizations, ids: evidence.externalIdentifiers }))
      .not.toMatch(/POISONVACANCY|POISONCITY|999999|POISONCOMPANY/iu);
    const adapter = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer());
    const canonical = adapter.canonicalize({
      canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-24") },
    });
    expect(JSON.stringify(canonical)).not.toMatch(/POISONVACANCY|POISONCITY|999999|POISONCOMPANY/iu);
    expect(observation).toEqual(before);
  });
  it("PROMAN strips dashboard/account content before persistence, unlike public raw snapshots", async () => {
    const f = setup();
    try {
      const sensitive = '<aside>ACCOUNT_MARKER_PRIVATE_VALUE</aside>';
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload(cases.proman, `${sensitive}${cases.proman.html}${sensitive}`));
      expect(result.processing.status).toBe("PROCESSED");
      const stored = (await f.deps.sourceObservationRepository.findById(result.capture.observationId))!;
      expect(JSON.stringify(stored)).not.toContain("ACCOUNT_MARKER_PRIVATE_VALUE");
      const before = structuredClone(stored);
      await createVacancyEvidenceExtractor().extract(stored);
      expect(await f.deps.sourceObservationRepository.findById(stored.id)).toEqual(before);
    } finally { f.db.close(); }
  });
});

describe("associated identity agreement contracts", () => {
  const identityCases = [
    { c: cases.michael, conflict: cases.michael.html.replace("JN-102026-7118382", "JN-102026-9999999"), malformed: cases.michael.pageUrl.replace("jn-102026-7118382", "jn-102026-7118382-extra") },
    { c: cases.hays, conflict: cases.hays.html.replace('id="jd_reference">8312<', 'id="jd_reference">8313<'), malformed: cases.hays.pageUrl.replace("/8312?", "/8312x?") },
    { c: cases.start, conflict: cases.start.html.replace('>9481983</p>', '>9481984</p>'), malformed: cases.start.pageUrl.replace("9481983", "9481983x") },
    { c: cases.lhh, conflict: cases.lhh.html.replace('<b class="job-id">2106003901</b>', '<b class="job-id">2106003902</b>'), malformed: cases.lhh.pageUrl.replace("2106003901", "2106003901x") },
  ];
  it.each(identityCases)("$c.name accepts matching identities, ignores unrelated IDs, and rejects associated conflicts", async ({ c, conflict }) => {
    expect(conflict).not.toBe(c.html);
    const base = acquisition(c).captured;
    expect(base.externalId).toBe(c.id);
    expect(base.contexts?.[0]?.providerExternalId).toBe(c.id);
    const unrelated = acquisition(c, `${c.html}<aside>Unrelated vacancy reference 9999999999</aside>`).captured;
    expect(unrelated.contexts?.[0]?.providerExternalId).toBe(c.id);
    const f = setup();
    try {
      const result = await f.runtime.captureAndProcessBrowserVacancy(payload(c, conflict));
      expect(result.processing.status).toBe("VACANCY_NOT_DETECTED");
      expect((await f.deps.sourceObservationRepository.findById(result.capture.observationId))?.source.externalId).toBe(c.id);
      for (const table of sideEffects) expect(rows(f.db, table)).toEqual([]);
    } finally { f.db.close(); }
  });
  it.each(identityCases)("$c.name does not normalize a malformed route ID into the valid vacancy", ({ c, malformed }) => {
    const { captured } = acquisition({ ...c, pageUrl: malformed });
    expect(captured.externalId).not.toBe(c.id);
    expect(captured.contexts).toBeUndefined();
  });
  it("allows LHH's agreeing route, selected reference and selected link together", () => {
    expect(cases.lhh.html).toContain('<b class="job-id">2106003901</b>');
    expect(cases.lhh.html).toContain("ingenieur-devops-hf-tours-indre-et-loire/2106003901");
    expect(acquisition(cases.lhh).captured.contexts?.[0]?.providerExternalId).toBe(cases.lhh.id);
  });
});

describe("recapture and immutable source contracts", () => {
  it.each([
    { c: cases.michael, role: "STAFFING_AGENCY" as const },
    { c: cases.lhh, role: "STAFFING_AGENCY" as const },
    { c: cases.hays, role: "EMPLOYER" as const },
    { c: cases.kelly, role: "EMPLOYER" as const },
  ])("$c.name retains decisions, assignments and immutable snapshots across recaptures", async ({ c, role }) => {
    const f = setup();
    try {
      const input = payload(c);
      const first = await f.runtime.captureAndProcessBrowserVacancy(input);
      expect(first.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true });
      if (first.processing.status !== "PROCESSED") throw Error("not processed");
      const id = first.processing.canonicalVacancyId;
      const original = (await f.deps.sourceObservationRepository.findById(first.capture.observationId))!;
      expect(original.rawContent).toBe(input.visibleText);
      expect(original.metadata.acquisition).toMatchObject({ html: c.html });
      const card = (await f.workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      expect(card.recommendedRole).toBe(role);
      await f.workflow.decideVacancyOrganizationRole({ canonicalVacancyId: id, requestId: "contract-decision", identityKey: card.identityKey, role, candidateToken: card.candidateToken, acknowledgeContradiction: true });
      const decisions = rows(f.db, "vacancy_organization_role_decisions");
      const assignments = rows(f.db, "observation_cluster_assignments");
      expect(decisions).toHaveLength(1);
      expect(assignments.length).toBeGreaterThan(0);
      const repeat = await f.runtime.captureAndProcessBrowserVacancy(input);
      expect(repeat.capture.observationId).toBe(first.capture.observationId);
      expect(repeat.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: id, observationAdded: false });
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([original.id])).toBe(2);
      expect(rows(f.db, "observation_cluster_assignments")).toEqual(assignments);
      const changed = await f.runtime.captureAndProcessBrowserVacancy({ ...input, visibleText: "Changed snapshot marker" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: id, observationAdded: true });
      expect(await f.deps.sourceObservationRepository.findById(original.id)).toEqual(original);
      expect(await f.deps.sourceObservationRepository.findById(changed.capture.observationId)).not.toEqual(original);
      expect(rows(f.db, "vacancy_organization_role_decisions")).toEqual(decisions);
      expect(rows(f.db, "observation_cluster_assignments")).toEqual(expect.arrayContaining(assignments));
      expect((await f.workflow.getVacancyReview(id)).organizationRoleReview![0]).toMatchObject({ confirmedRole: role });
    } finally { f.db.close(); }
  });
});

describe("public capture result contract", () => {
  it("transports rejected, new and existing captures without a dummy review ID", async () => {
    const f = setup();
    const server = createBrowserCaptureServer({ captureAndProcessBrowserVacancy: f.runtime.captureAndProcessBrowserVacancy });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      async function send(input: ReturnType<typeof payload>) {
        const response = await fetch(`http://127.0.0.1:${address.port}/acquisition/browser`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
        });
        expect(response.status).toBe(201);
        return await response.json() as { success: boolean; processing: Record<string, unknown> };
      }
      const rejected = await send(payload(cases.michael, "<main>Vacancy unavailable</main>"));
      expect(rejected.success).toBe(true);
      expect(rejected.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false, rejectionReason: "NO_TRUSTED_VACANCY_CONTEXT" });
      expect(rejected.processing).not.toHaveProperty("canonicalVacancyId");
      const accepted = await send(payload(cases.michael));
      expect(accepted.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, vacancyOutcome: "CREATED" });
      expect(accepted.processing.canonicalVacancyId).toEqual(expect.any(String));
      const again = await send(payload(cases.michael));
      expect(again.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: accepted.processing.canonicalVacancyId, observationAdded: false });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      f.db.close();
    }
  });
});

// Provider-specific contracts remain in their suites: PROMAN sanitizes before storage;
// Indeed has selected/native/direct/company-jobs variants; LinkedIn has search and direct views;
// Adecco may derive identity from the pane; Talent has legacy ID namespaces.
// LHH's legacy direct route is intentionally rejected. Personio, generic Workday, Bürkert
// and Daimler Truck have explicit acceptance paths outside the ordinary locator contract.
