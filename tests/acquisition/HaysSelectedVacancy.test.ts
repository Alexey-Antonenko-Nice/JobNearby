import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { HaysSelectedVacancyContextLocator, haysSalary, haysVacancyId } from "../../src/application/acquisition/HaysVacancy.js";
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

const url = "https://m.hays.fr/careers/Job/Detail/8312?lang=fr";
const html = readFileSync("tests/fixtures/haysSelectedVacancy.html", "utf8");
const extractor = createVacancyEvidenceExtractor();
const intermediary = ["STAFFING_AGENCY", "RECRUITER", "RECRUITMENT_AGENCY"];

function capture(content = html, pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ html: content, pageUrl, pageTitle: "Hays",
    visibleText: "Autre poste Paris 999999 EUR / YEAR Remote", capturedAt: "2026-10-24T10:00:00Z" }, "acquisition");
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
const withDescription = (text: string) => html.replace("Bienvenue chez HAYS !", `Bienvenue chez HAYS ! ${text}`);

describe("Hays internal careers vacancy", () => {
  it("recognizes m.hays.fr and the /careers/Job/Detail/<id> route", () => {
    expect(haysVacancyId(url)).toBe("8312");
    expect(haysVacancyId("https://m.hays.fr/careers/Job/Detail/8312/")).toBe("8312");
    for (const bad of ["https://m.hays.fr/careers/Job/Detail/abc", "https://m.hays.fr/careers/Job/Detail/8312/x", "https://www.hays.fr/careers/Job/Detail/8312", "https://m.hays.fr/other/Job/Detail/8312", "https://m.hays.fr.evil.test/careers/Job/Detail/8312"])
      expect(haysVacancyId(bad)).toBeUndefined();
    const { acquisition, observation } = capture();
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "HAYS", providerExternalId: "8312" });
    expect(observation.source).toMatchObject({ sourceName: "m.hays.fr", externalId: "8312" });
  });
  it("captures exactly the current vacancy and nothing from navigation, search, related jobs, contact or footer", () => {
    const context = capture().acquisition.contexts![0]!;
    expect(context.text).toContain("Team Leader / Manager Recrutement IT H/F");
    expect(context.text).toContain("Réf.:");
    expect(context.text).toContain("IT Contracting");
    expect(context.html).not.toMatch(/<nav|<form|<input|<footer/iu);
    expect(context.text).not.toMatch(/Rechercher des offres|Autre poste|999999|Contactez-nous|recruiter@example|Jane Recruiter|Partagez|Remote Contract/u);
  });
  it("extracts title, clean location, engagement and no work mode", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.role.value?.title).toBe("Team Leader / Manager Recrutement IT H/F");
    expect(evidence.locations).toEqual([expect.objectContaining({ value: "Strasbourg", role: "WORKPLACE" })]);
    expect(canonical.location.value?.rawText).toBe("Strasbourg");
    expect(evidence.engagements.flatMap(e => e.normalizedTerms).sort()).toEqual(["FULL_TIME", "INDEFINITE"]);
    expect(canonical.engagement.value?.normalizedTerms.slice().sort()).toEqual(["FULL_TIME", "INDEFINITE"]);
    expect(evidence.workModes).toEqual([]);
    expect(canonical.workMode.status).toBe("UNKNOWN");
  });
  it("does not duplicate the indefinite term from CDI wording", async () => {
    const { evidence } = await project();
    expect(evidence.engagements.flatMap(e => e.normalizedTerms).filter(term => term === "INDEFINITE")).toHaveLength(1);
  });
  it("normalizes the annual salary while preserving variable pay and TR as raw context", async () => {
    const { evidence, canonical, observation } = await project();
    expect(evidence.compensations).toEqual([expect.objectContaining({ currency: "EUR", minimum: 38000, maximum: 40000, period: "YEAR", rawText: "Salaire fixe annuel de 38 à 40 K€ + variable + TR" })]);
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { currency: "EUR", minimum: 38000, maximum: 40000, period: "YEAR" } });
    expect(observation.salaryText).toBe("Salaire fixe annuel de 38 à 40 K€ + variable + TR");
    expect(observation.salaryText).not.toMatch(/euro \/ YEAR/u);
  });
  it.each(["38 à 40 K€", "38-40 K€", "38 K€ à 40 K€", "Salaire fixe annuel de 38 à 40 K€", "38 – 40 k€ brut"])("normalizes %s", text => {
    expect(haysSalary(text)).toMatchObject({ currency: "EUR", minimum: 38000, maximum: 40000, period: "YEAR" });
  });
  it.each(["40 à 38 K€", "3000 € par mois", "38 à 40 K€ par mois", "Selon profil"])("rejects %s", text => {
    expect(haysSalary(text)).toBeUndefined();
  });
  it("extracts Hays as the displayed organization and external ID without structured-payload fields", async () => {
    const { evidence } = await project();
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Hays", role: "DISPLAYED_COMPANY" }));
    expect(evidence.externalIdentifiers).toEqual([expect.objectContaining({ value: "8312", identifierType: "SOURCE_EXTERNAL_ID" })]);
  });
  it("recommends employer from internal-careers wording, not from recruitment vocabulary", async () => {
    const { evidence } = await project();
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Hays", role: "EMPLOYER", provenance: expect.objectContaining({ confidence: 0.98 }) }));
    expect(evidence.organizations.some(o => intermediary.includes(o.role))).toBe(false);
  });
  it.each(["Recrutement clients talents IT Contracting manager recrutement.", "Vous accompagnez nos clients et recrutez des talents."])(
    "does not treat occupational recruitment vocabulary as a client assignment: %s", async text => {
      const { evidence } = await project(withDescription(text));
      expect(evidence.organizations.some(o => intermediary.includes(o.role))).toBe(false);
      expect(evidence.organizations).toContainEqual(expect.objectContaining({ role: "EMPLOYER" }));
    });
  it.each(["Mission chez notre client à Lyon.", "Notre client recrute un développeur.", "Poste pour notre client, leader du secteur."])(
    "honors vacancy-level client-assignment wording: %s", async text => {
      const { evidence } = await project(withDescription(text));
      expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Hays", role: "STAFFING_AGENCY" }));
      expect(evidence.organizations.some(o => o.role === "EMPLOYER")).toBe(false);
    });
  it("makes no global hays.fr employer rule: absent first-person wording gives no employer role", async () => {
    const { evidence } = await project(html.replace("Bienvenue chez HAYS !", "Bonjour !").replace(/nos 9 500 experts/u, "des experts"));
    expect(evidence.organizations.map(o => o.role)).toEqual(["DISPLAYED_COMPANY"]);
  });
  it.each([
    html.replace('id="jd_reference">8312<', 'id="jd_reference">8313<'),
    html.replace('id="JobId" hidden="hidden">8312<', 'id="JobId" hidden="hidden">8399<'),
    html.replace('rel="canonical" href="https://m.hays.fr/careers/Job/Detail/8312?lang=fr"', 'rel="canonical" href="https://m.hays.fr/careers/Job/Detail/9999"'),
  ])("fails closed on conflicting explicit IDs while keeping the route ID", async content => {
    const { acquisition, evidence } = await project(content);
    expect(acquisition.externalId).toBe("8312");
    expect(acquisition.contexts).toBeUndefined();
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
  });
  it.each([
    html + html,
    html.replace('class="bg-white job-details"', 'class="unknown-details"'),
    html.replace('id="jd_salary"', 'id="x_salary"').replace('id="jd_reference"', 'id="x_reference"'),
    html.replace('id="jd_location"', 'id="jd_reference"'),
  ])("fails safe, never falling back to whole-page extraction", async content => {
    const { acquisition, evidence } = await project(content);
    expect(acquisition.contexts).toBeUndefined();
    for (const items of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.engagements, evidence.compensations]) expect(items).toEqual([]);
  });
  it("validates a supplied primary ID instead of trusting stale context", () => {
    expect(new HaysSelectedVacancyContextLocator().locate({ providerKey: "HAYS", sourceUrl: url, externalId: "8313", html })).toBeUndefined();
  });
});

describe("Hays organization-role review and recapture", () => {
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
      const result = await runtime.captureAndProcessBrowserVacancy({ html: content, pageUrl, pageTitle: "Hays", visibleText: "Hays", capturedAt: new Date("2026-10-24T10:00:00Z") });
      if (result.processing.status !== "PROCESSED") throw Error(JSON.stringify(result.processing));
      return { ...result, id: result.processing.canonicalVacancyId };
    }
    async function choose(id: string, role: "EMPLOYER" | "STAFFING_AGENCY") {
      const card = (await workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      return workflow.decideVacancyOrganizationRole({ canonicalVacancyId: id, requestId: crypto.randomUUID(), identityKey: card.identityKey, role, candidateToken: card.candidateToken, acknowledgeContradiction: true });
    }
    return { db, deps, workflow, run, choose, rows: (t: string) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() };
  }
  it("recommends EMPLOYER for the internal vacancy despite a prior Hays staffing-agency decision, with all alternatives", async () => {
    const f = fixture();
    try {
      const client = await f.run(withDescription("Mission chez notre client.").replaceAll("8312", "8400"), "https://m.hays.fr/careers/Job/Detail/8400");
      expect((await f.workflow.getVacancyReview(client.id)).organizationRoleReview![0]).toMatchObject({ name: "Hays", recommendedRole: "STAFFING_AGENCY" });
      await f.choose(client.id, "STAFFING_AGENCY");
      const internal = await f.run();
      const card = (await f.workflow.getVacancyReview(internal.id)).organizationRoleReview![0]!;
      expect(card).toMatchObject({ name: "Hays", recommendedRole: "EMPLOYER", confirmedRole: null });
      expect(card.history.map(h => h.role)).toContain("STAFFING_AGENCY");
      expect(card.actions.map(a => a.role)).toEqual(["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"]);
      expect(card.reasons).toEqual(["Hays internal careers route", "First-person Hays employer wording", "No recruiting-for-client assignment evidence"]);
    } finally { f.db.close(); }
  });
  it("reuses exact recaptures, keeps the canonical vacancy for changed snapshots and preserves human decisions", async () => {
    const f = fixture();
    try {
      const first = await f.run();
      expect((await f.deps.sourceObservationRepository.findById(first.capture.observationId))?.source.externalId).toBe("8312");
      await f.choose(first.id, "EMPLOYER");
      const decisions = f.rows("vacancy_organization_role_decisions");
      for (let i = 0; i < 2; i++) {
        const again = await f.run();
        expect(again.capture.observationId).toBe(first.capture.observationId);
        expect(again.id).toBe(first.id);
      }
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      const changed = await f.run(html.replace("Chaque jour,", "Chaque jour de la semaine,"));
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.id).toBe(first.id);
      expect(f.rows("vacancy_organization_role_decisions")).toEqual(decisions);
      expect((await f.workflow.getVacancyReview(first.id)).organizationRoleReview![0]).toMatchObject({ recommendedRole: "EMPLOYER", confirmedRole: "EMPLOYER" });
    } finally { f.db.close(); }
  });
});
