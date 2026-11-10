import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { ExpectraSelectedVacancyContextLocator, expectraVacancyId } from "../../src/application/acquisition/ExpectraVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteConfirmedOrganizationRoleRepository } from "../../src/infrastructure/persistence/SqliteConfirmedOrganizationRoleRepository.js";
import { SqliteVacancyOrganizationRoleDecisionRepository } from "../../src/infrastructure/persistence/SqliteVacancyOrganizationRoleDecisionRepository.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";

const html = readFileSync("tests/fixtures/expectraMonacoVacancy.html", "utf8");
const pageUrl = "https://expectra.mc/offre-emploi/826-acheteur-approvisionneur-h-f";
const payload = { pageUrl, html, pageTitle: "Expectra", visibleText: "Paris CDI 999 000 € télétravail Randstad", capturedAt: "2026-11-10T12:00:00Z" };
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
function capture(content = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: content }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
describe("Expectra Monaco direct vacancy", () => {
  it("extracts route identity and bounded selected facts, not generic agency text", async () => {
    expect(expectraVacancyId(pageUrl)).toBe("826");
    for (const bad of [pageUrl.replace("expectra.mc", "other.mc"), "https://expectra.mc/offre-emploi/826", "https://expectra.mc/offre-emploi/foo"]) expect(expectraVacancyId(bad)).toBeUndefined();
    const { acquisition, observation } = capture();
    expect(observation.source).toMatchObject({ sourceName: "expectra.mc", externalId: "826" });
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "EXPECTRA_MONACO", providerExternalId: "826" });
    expect(acquisition.contexts![0]!.text).not.toMatch(/Randstad|Paris|999 000|télétravail|recrutement/u);
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(x => x.value)).toEqual(["ACHETEUR/APPROVISIONNEUR H/F"]);
    expect(evidence.experienceRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ minimumYears: 4, unit: "YEAR", rawText: expect.stringMatching(/4 ans minimum/u) })]));
    expect(evidence.languageRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ language: "English", rawText: "Anglais courant" })]));
    expect(evidence.languageRequirements.find(x => x.language === "English")?.level).toBeUndefined();
    for (const values of [evidence.locations, evidence.engagements, evidence.compensations, evidence.workModes]) expect(values).toEqual([]);
    expect(evidence.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Expectra", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ value: "Expectra", role: "STAFFING_AGENCY" }),
    ]));
    expect(evidence.organizations.some(x => x.value !== "Expectra" || ["EMPLOYER", "CLIENT"].includes(x.role))).toBe(false);
  });
  it.each([
    html.replace('class="band band-offer"', 'class="other"'),
    html.replace("<h1>", "<h2>").replace("</h1>", "</h2>"),
    html.replace("[#826]", "[#827]"),
    html.replace("postulate826", "postulate827"),
    html.replace("/add_cart/826", "/add_cart/827"),
    html.replace("</head>", '<link rel="canonical" href="/offre-emploi/827-other"></head>'),
    html.replace("</head>", '<script type="application/ld+json">{"@type":"JobPosting","identifier":"827"}</script></head>'),
    html.replace('class="band band-offer"', 'class="band band-offer" hidden'),
    html.replace('class="intro"', 'class="intro" hidden'),
    html.replace("Profil recherché", "Autre"),
    html.replace('<div class="band band-offer">', '<div class="band band-offer"></div><div class="band band-offer">'),
  ])("rejects malformed or conflicting layouts without promotion", async invalid => {
    const f = setup();
    try {
      const result = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, html: invalid });
      expect(result.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false });
      expect(await f.deps.sourceObservationRepository.findById(result.capture.observationId)).not.toBeNull();
      for (const table of ["canonical_vacancies", "employer_clusters", "observation_cluster_assignments"])
        expect(f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    } finally { f.db.close(); }
  });
  it("rejects mismatched supplied identities", () => {
    expect(new ExpectraSelectedVacancyContextLocator().locate({ providerKey: "EXPECTRA_MONACO", sourceUrl: pageUrl, externalId: "827", html })).toBeUndefined();
  });
  it("does not promote a title when the direct route has no ID", async () => {
    const f = setup();
    try {
      const result = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: "https://expectra.mc/offre-emploi/acheteur" });
      expect(result.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false });
      expect(await f.deps.sourceObservationRepository.findById(result.capture.observationId)).not.toBeNull();
      for (const table of ["canonical_vacancies", "employer_clusters", "observation_cluster_assignments"])
        expect(f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    } finally { f.db.close(); }
  });
  it("does not infer an agency role from branding alone", async () => {
    const { observation } = capture(html.replace("Confiez-nous votre recrutement", "Notre équipe"));
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Expectra", role: "DISPLAYED_COMPANY" }));
    expect(evidence.organizations.some(x => x.role === "STAFFING_AGENCY")).toBe(false);
  });
  it("ignores stale unbounded projections when the selected boundary is missing", async () => {
    const { observation } = capture(html.replace('class="band band-offer"', 'class="other"'));
    const evidence = await createVacancyEvidenceExtractor().extract({ ...observation, title: "Poison", locationText: "Paris", displayedCompanyName: "Randstad", contractText: "CDI", salaryText: "999000 EUR", rawContent: "Paris CDI Randstad" });
    for (const values of [evidence.vacancyTitles, evidence.locations, evidence.organizations, evidence.engagements, evidence.compensations]) expect(values).toEqual([]);
  });
  it("accepts, recommends staffing and preserves decisions through recaptures", async () => {
    const f = setup();
    try {
      const first = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(first.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, employerStatus: "UNRESOLVED_RECORD_CREATED" });
      if (first.processing.status !== "PROCESSED") throw Error("not processed");
      const id = first.processing.canonicalVacancyId;
      const vacancy = (await f.deps.canonicalVacancyRepository.findById(id))!;
      expect(vacancy.role.value?.title).toBe("ACHETEUR/APPROVISIONNEUR H/F");
      for (const field of [vacancy.location, vacancy.engagement, vacancy.compensation, vacancy.workMode]) expect(field.status).toBe("UNKNOWN");
      expect(vacancy.experienceRequirements.value).toEqual(expect.arrayContaining([expect.objectContaining({ minimumYears: 4 })]));
      expect(vacancy.languageRequirements.value).toEqual(expect.arrayContaining([expect.objectContaining({ language: "English" })]));
      const observation = (await f.deps.sourceObservationRepository.findById(first.capture.observationId))!;
      const evidence = await createVacancyEvidenceExtractor().extract(observation);
      expect(evidence.organizations.every(x => x.value === "Expectra" && !["EMPLOYER", "CLIENT"].includes(x.role))).toBe(true);
      expect(evidence.languageRequirements.find(x => x.language === "English")?.level).toBeUndefined();
      const card = (await f.workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      expect(card).toMatchObject({ name: "Expectra", recommendedRole: "STAFFING_AGENCY" });
      expect(card.actions.map(x => x.role)).toEqual(["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"]);
      await f.workflow.decideVacancyOrganizationRole({ canonicalVacancyId: id, requestId: "decision", identityKey: card.identityKey, role: "STAFFING_AGENCY", candidateToken: card.candidateToken, acknowledgeContradiction: true });
      const decisions = f.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const same = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(same.capture.observationId).toBe(first.capture.observationId);
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(2);
      const changed = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replace("Analyser les besoins", "Analyser les différents besoins") });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: id, observationAdded: true });
      expect(f.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
    } finally { f.db.close(); }
  });
});

it.skipIf(!process.env.EXPECTRA_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays the saved Expectra page in an isolated database", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const f = setup();
  try {
    const original = (await new SqliteSourceObservationRepository(disk).findById("2fee1a58-1b18-4793-b316-aad7f1cd04d8"))!;
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const result = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, html: acquisition.html, pageTitle: acquisition.pageTitle, visibleText: original.rawContent! });
    expect(result.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, employerStatus: "UNRESOLVED_RECORD_CREATED" });
    if (result.processing.status !== "PROCESSED") throw Error("not processed");
    const vacancy = (await f.deps.canonicalVacancyRepository.findById(result.processing.canonicalVacancyId))!;
    expect(vacancy.role.value?.title).toBe("ACHETEUR/APPROVISIONNEUR H/F");
    expect(vacancy.experienceRequirements.value).toEqual(expect.arrayContaining([expect.objectContaining({ minimumYears: 4 })]));
    expect(vacancy.languageRequirements.value).toEqual(expect.arrayContaining([expect.objectContaining({ language: "English" })]));
    const observation = (await f.deps.sourceObservationRepository.findById(result.capture.observationId))!;
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.organizations.every(x => x.value === "Expectra" && !["EMPLOYER", "CLIENT"].includes(x.role))).toBe(true);
    expect(evidence.languageRequirements.find(x => x.language === "English")?.level).toBeUndefined();
    for (const field of [vacancy.location, vacancy.engagement, vacancy.compensation, vacancy.workMode]) expect(field.status).toBe("UNKNOWN");
    expect((await f.workflow.getVacancyReview(vacancy.id)).organizationRoleReview).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Expectra", recommendedRole: "STAFFING_AGENCY" })]));
  } finally { disk.close(); f.db.close(); }
});
