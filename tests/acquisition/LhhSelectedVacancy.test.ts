import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { LhhSelectedVacancyContextLocator, lhhSalary, lhhVacancyId } from "../../src/application/acquisition/LhhVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";

const url = "https://www.lhh.com/fr-fr/offres-emploi?jobId=2106003901";
const html = readFileSync("tests/fixtures/lhhSelectedVacancy.html", "utf8");
const extractor = createVacancyEvidenceExtractor();

function capture(content = html, pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html: content, pageUrl, pageTitle: "LHH",
    visibleText: "Responsable Marketing MONTAUBAN CDD € 45000 - € 55000 / Annuel intérim spécialisé", capturedAt: "2026-10-24T10:00:00Z" }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(content = html, pageUrl = url) {
  const { acquisition, observation } = capture(content, pageUrl);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
    derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-24") },
  });
  return { acquisition, observation, evidence, canonical };
}
const neighbours = /Responsable Marketing|MONTAUBAN|Technicien M|FRESSENNEVILLE|Responsable Ressources|AUCH|45000 - € 55000|30000|50000/u;

describe("LHH selected vacancy", () => {
  it("recognizes the jobId route and the legacy detail route only", () => {
    expect(lhhVacancyId(url)).toBe("2106003901");
    expect(lhhVacancyId("https://www.lhh.com/fr-fr/offres-emploi/detail/2089206701")).toBe("2089206701");
    for (const bad of ["https://www.lhh.com/fr-fr/offres-emploi", "https://www.lhh.com/fr-fr/offres-emploi?jobId=abc", "https://www.lhh.com/fr-fr/offres-emploi?jobId=1&jobId=2", "https://www.lhh.com/fr-fr/autre?jobId=1", "https://lhh.com.evil.test/fr-fr/offres-emploi?jobId=1"])
      expect(lhhVacancyId(bad)).toBeUndefined();
    const { acquisition, observation } = capture();
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "LHH", providerExternalId: "2106003901" });
    expect(observation.source).toMatchObject({ sourceName: "lhh.com", externalId: "2106003901" });
  });
  it("captures only the selected pane", () => {
    const context = capture().acquisition.contexts![0]!;
    expect(context.text).toContain("Ingénieur DevOps (H/F)");
    expect(context.text).toContain("2106003901");
    expect(context.text).not.toMatch(neighbours);
  });
  it("extracts title, raw-preserving location and CDI as the only engagement", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.role.value?.title).toBe("Ingénieur DevOps (H/F)");
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "TOURS, Indre-Et-Loire", role: "WORKPLACE" })]);
    expect(canonical.location.value?.rawText).toBe("TOURS, Indre-Et-Loire");
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INDEFINITE"]);
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
    expect(canonical.engagement.alternatives ?? []).toEqual([]);
  });
  it("does not derive INTERIM from LHH's 'intérim spécialisé' business description", async () => {
    const { evidence, canonical, acquisition } = await project();
    expect(acquisition.contexts![0]!.text).toContain("intérim spécialisé");
    expect(JSON.stringify(evidence.engagements)).not.toMatch(/INTERIM/u);
    expect(JSON.stringify(canonical.engagement)).not.toMatch(/INTERIM/u);
  });
  it("normalizes EUR 40000-45000 per year and keeps the raw text", async () => {
    const { evidence, canonical } = await project();
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "€ 40000 - € 45000 / Annuel", currency: "EUR", minimum: 40000, maximum: 45000, period: "YEAR" })]);
    expect(canonical.compensation.value).toMatchObject({ minimum: 40000, maximum: 45000, currency: "EUR", period: "YEAR" });
  });
  it.each(["€ 40000 - € 45000 / Annuel", "€40000 - €45000 / Annuel", "40 000 € - 45 000 € / Annuel", "€ 40000 à € 45000 / Annuel"])("parses salary variant %s", text => {
    expect(lhhSalary(text)).toMatchObject({ rawText: text, minimum: 40000, maximum: 45000, currency: "EUR", period: "YEAR" });
  });
  it.each(["€ 2500 - € 3000 / Mensuel", "€ 45000 - € 40000 / Annuel", "salaire"])("rejects unsupported salary %s", text => expect(lhhSalary(text)).toBeUndefined());
  it("extracts LHH Recruitment Solutions as displayed company and staffing agency, with no employer or client", async () => {
    const { evidence } = await project();
    expect(evidence.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "LHH Recruitment Solutions", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ value: "LHH Recruitment Solutions", role: "STAFFING_AGENCY" }),
    ]));
    expect(evidence.organizations.some(o => ["EMPLOYER", "CLIENT"].includes(o.role))).toBe(false);
    expect(evidence.externalIdentifiers).toEqual([expect.objectContaining({ value: "2106003901", identifierType: "SOURCE_EXTERNAL_ID" })]);
  });
  it("keeps experience from the selected pane only", async () => {
    const { evidence } = await project();
    expect(JSON.stringify(evidence)).toMatch(/3 ans/u);
    const other = await project(html.replace("3 ans d'expérience", "5 ans d'expérience"));
    expect(JSON.stringify(other.evidence)).not.toMatch(/3 ans/u);
  });
  it("does not let neighbouring cards leak into any field", async () => {
    const { evidence, canonical } = await project();
    expect(JSON.stringify({ evidence, canonical })).not.toMatch(neighbours);
  });
  it("derives the same vacancy when list cards change", async () => {
    const changed = html.replace(/MONTAUBAN/gu, "LILLE").replace("€ 45000 - € 55000", "€ 70000 - € 80000");
    const a = await project(), b = await project(changed);
    expect(b.canonical.role.value?.title).toBe(a.canonical.role.value?.title);
    expect(b.evidence.compensations).toEqual(a.evidence.compensations);
  });
  it.each(["recherche pour son client", "recherche pour notre client"])("staffing semantics require client wording: %s", async wording => {
    const { evidence } = await project(html.replace("recherche pour son client", wording));
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ role: "STAFFING_AGENCY" }));
  });
  it("does not derive a staffing role from LHH business vocabulary alone", async () => {
    const { evidence } = await project(html.replace("recherche pour son client", "recherche un"));
    expect(evidence.organizations.map(o => o.role)).toEqual(["DISPLAYED_COMPANY"]);
  });
  it.each([
    html.replace('<b class="job-id">2106003901</b>', '<b class="job-id">2106003902</b>'),
    html.replace(/ingenieur-devops-hf-tours-indre-et-loire\/2106003901/u, "ingenieur-devops-hf-tours-indre-et-loire/2106003999"),
  ])("fails closed on conflicting explicit IDs while keeping the URL ID", async content => {
    const { acquisition, evidence } = await project(content);
    expect(acquisition.externalId).toBe("2106003901");
    expect(acquisition.contexts).toBeUndefined();
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.engagements, evidence.compensations]) expect(items).toEqual([]);
  });
  it.each([
    html.replace(/job_Details/gu, "other_pane"),
    html + html.slice(html.indexOf('<section class="JobSearch_line-break__923PP job_Details">')),
    html.replace('<b class="job-id">2106003901</b>', ""),
    html.replace("VacancyDescription", "Other"),
  ])("fails safe without whole-page fallback", async content => {
    const { acquisition, evidence } = await project(content);
    expect(acquisition.externalId).toBe("2106003901");
    expect(acquisition.contexts).toBeUndefined();
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.engagements, evidence.compensations]) expect(items).toEqual([]);
  });
  it("fails safe without a jobId and validates a supplied primary ID", async () => {
    const { acquisition, evidence } = await project(html, "https://www.lhh.com/fr-fr/offres-emploi");
    expect(acquisition.externalId).toBeUndefined();
    expect(acquisition.contexts).toBeUndefined();
    expect(evidence.vacancyTitles).toEqual([]);
    expect(new LhhSelectedVacancyContextLocator().locate({ providerKey: "LHH", sourceUrl: url, externalId: "1", html })).toBeUndefined();
  });
});

describe("LHH organization-role review and recapture", () => {
  function fixture() {
    const db = createDatabase(":memory:");
    const deps = {
      aliasRepository: new SqliteEmployerAliasEvidenceRepository(db), canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
      sourceObservationRepository: new SqliteSourceObservationRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db),
      employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
      employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db), agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db),
      organizationRoleDecisionRepository: new SqliteVacancyOrganizationRoleDecisionRepository(db),
    };
    const workflow = createVacancyReviewWorkflow(deps), runtime = createCaptureProcessingRuntime(db);
    async function run(content = html, pageUrl = url) {
      const result = await runtime.captureAndProcessBrowserVacancy({ html: content, pageUrl, pageTitle: "LHH", visibleText: "LHH", capturedAt: new Date("2026-10-24T10:00:00Z") });
      if (result.processing.status !== "PROCESSED") throw Error(JSON.stringify(result.processing));
      return { ...result, id: result.processing.canonicalVacancyId };
    }
    async function choose(id: string, role: "EMPLOYER" | "STAFFING_AGENCY", acknowledgeContradiction = true) {
      const card = (await workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      return workflow.decideVacancyOrganizationRole({ canonicalVacancyId: id, requestId: crypto.randomUUID(), identityKey: card.identityKey, role, candidateToken: card.candidateToken, acknowledgeContradiction });
    }
    return { db, deps, workflow, run, choose, rows: (t: string) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() };
  }
  it("recommends STAFFING_AGENCY with all alternatives visible and no employer or client organization", async () => {
    const f = fixture();
    try {
      const vacancy = await f.run();
      const review = (await f.workflow.getVacancyReview(vacancy.id)).organizationRoleReview!;
      expect(review).toHaveLength(1);
      expect(review[0]).toMatchObject({ name: "LHH Recruitment Solutions", recommendedRole: "STAFFING_AGENCY", confirmedRole: null });
      expect(review[0]!.actions.map(a => a.role)).toEqual(["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"]);
    } finally { f.db.close(); }
  });
  it("reuses exact recaptures, keeps the canonical vacancy for changed snapshots and preserves human decisions", async () => {
    const f = fixture();
    try {
      const first = await f.run();
      expect((await f.deps.sourceObservationRepository.findById(first.capture.observationId))?.source.externalId).toBe("2106003901");
      await f.choose(first.id, "STAFFING_AGENCY");
      const decisions = f.rows("vacancy_organization_role_decisions");
      for (let i = 0; i < 2; i++) {
        const again = await f.run();
        expect(again.capture.observationId).toBe(first.capture.observationId);
        expect(again.id).toBe(first.id);
      }
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      const changed = await f.run(html.replace("Votre mission", "Votre mission principale"));
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.id).toBe(first.id);
      expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
      expect((await f.workflow.getVacancyReview(first.id)).organizationRoleReview![0]).toMatchObject({ recommendedRole: "STAFFING_AGENCY", confirmedRole: "STAFFING_AGENCY" });
    } finally { f.db.close(); }
  });
  it("requires the existing contradiction acknowledgement before an EMPLOYER decision", async () => {
    const f = fixture();
    try {
      const vacancy = await f.run();
      await expect(f.choose(vacancy.id, "EMPLOYER", false)).rejects.toThrow(/requires confirmation/u);
      expect((await f.workflow.getVacancyReview(vacancy.id)).organizationRoleReview![0]).toMatchObject({ confirmedRole: null });
      await f.choose(vacancy.id, "EMPLOYER");
      expect((await f.workflow.getVacancyReview(vacancy.id)).organizationRoleReview![0]).toMatchObject({ confirmedRole: "EMPLOYER", recommendedRole: "STAFFING_AGENCY" });
    } finally { f.db.close(); }
  });
});
