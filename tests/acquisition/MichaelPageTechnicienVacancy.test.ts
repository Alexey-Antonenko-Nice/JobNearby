import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { michaelPageSalary, michaelPageVacancyId } from "../../src/application/acquisition/MichaelPageVacancy.js";
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

const html = readFileSync("tests/fixtures/michaelPageTechnicienVacancy.html", "utf8");
const pageUrl = "https://www.michaelpage.fr/job-detail/technicienne-sav-france-fh/ref/jn-102026-7118382";
const payload = { pageUrl, html, pageTitle: "Michael Page", visibleText: "Offres similaires Mayenne Télétravail possible", capturedAt: "2026-11-10T12:00:00Z" };
const neighbours = /72\/61\/53|Mayenne|31 000|36 000|Brevets|Charenton|Télétravail possible/u;

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

describe("Michael Page updated direct vacancy", () => {
  it("recognizes the route and extracts only bounded visible vacancy facts", async () => {
    expect(michaelPageVacancyId(pageUrl)).toBe("jn-102026-7118382");
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload, "acquisition");
    expect(acquisition.externalId).toBe("jn-102026-7118382");
    const context = acquisition.contexts![0]!;
    expect(context).toMatchObject({ providerKey: "MICHAEL_PAGE", providerExternalId: "jn-102026-7118382", metadata: { updateText: "Mise à jour le 06/11/2026" } });
    expect(context.text).toContain("déplacements réguliers");
    expect(context.text).not.toMatch(neighbours);
    expect(context.html).not.toMatch(/similar-jobs|<nav\b|<footer\b|application\/ld\+json/u);
    const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
    expect(observation.publishedAt).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(x => x.value)).toEqual(["Technicien(ne) SAV France (F/H)"]);
    expect(evidence.locations.map(x => x.value)).toEqual(["Cosse-le-Vivien"]);
    expect(evidence.engagements.flatMap(x => x.normalizedTerms)).toEqual(["INDEFINITE"]);
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "30 000€ - 40 000€ par an", currency: "EUR", minimum: 30000, maximum: 40000, period: "YEAR" })]);
    expect(evidence.workModes).toEqual([]);
    expect(evidence.travelRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawText: "déplacements réguliers", requirement: "REQUIRED", frequency: "REGULAR" }),
      expect.objectContaining({ rawText: "Déplacements fréquents", requirement: "REQUIRED", frequency: "FREQUENT" }),
    ]));
    expect(evidence.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Michael Page", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ value: "Michael Page", role: "STAFFING_AGENCY" }),
    ]));
    expect(evidence.organizations.some(x => ["EMPLOYER", "CLIENT"].includes(x.role))).toBe(false);
    expect(JSON.stringify(evidence)).not.toMatch(neighbours);
  });
  it.each(["30 000 € - 40 000 € par an", "30 000€ - 40 000€ par an", "30K€ - 40K€ par an"])("parses salary %s", value => {
    expect(michaelPageSalary(value)).toEqual({ rawText: value, currency: "EUR", minimum: 30000, maximum: 40000, period: "YEAR" });
  });
  it.each(["40K€ - 30K€ par an", "30K€ - 40K€ par mois", "not disclosed"])("rejects salary %s", value => expect(michaelPageSalary(value)).toBeUndefined());
  it("does not infer an intermediary role from branding without selected client wording", async () => {
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: html.replaceAll("Notre client", "Cette société") }, "acquisition");
    const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Michael Page", role: "DISPLAYED_COMPANY" }));
    expect(evidence.organizations.some(x => ["STAFFING_AGENCY", "RECRUITMENT_AGENCY"].includes(x.role))).toBe(false);
  });
  it("ignores unrelated structured postings and preserves the selected context", async () => {
    const other = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", url: "https://www.michaelpage.fr/job-detail/other/ref/jn-102026-9999999", title: "Other", jobLocationType: "TELECOMMUTE" })}</script>`;
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: html + other }, "acquisition");
    expect(acquisition.contexts?.[0]?.text).not.toContain("Other");
    const evidence = await createVacancyEvidenceExtractor().extract(new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation"));
    expect(evidence.workModes).toEqual([]);
    expect(evidence.vacancyTitles.map(x => x.value)).toEqual(["Technicien(ne) SAV France (F/H)"]);
  });
  it.each([
    html.replace('class="job-advert full clearfix"', 'class="other"'),
    html.replace('class="job-apply-job-title"', 'class="other"'),
    html.replace("JN-102026-7118382", "JN-102026-9999999"),
    html + html.slice(html.indexOf('<article '), html.indexOf("</article>") + 10),
    html.replace("<article ", "<article hidden "),
    html.replace("Mise à jour le 06/11/2026", "Mise à jour le 31/02/2026"),
    html.replace('"employmentType":"FULL_TIME"', '"identifier":"jn-102026-9999999","employmentType":"FULL_TIME"'),
  ])("retains rejected captures without vacancy or employer records", async invalidHtml => {
    const f = setup();
    try {
      const result = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, html: invalidHtml });
      expect(result.processing).toMatchObject({ status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false });
      expect(await f.deps.sourceObservationRepository.findById(result.capture.observationId)).not.toBeNull();
      for (const table of ["canonical_vacancies", "employer_clusters", "observation_cluster_assignments"]) {
        expect(f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
    } finally { f.db.close(); }
  });
  it("accepts, recommends staffing, requires contradiction confirmation and retains decisions on recapture", async () => {
    const f = setup();
    try {
      const first = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(first.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, canonicalizationStatus: "USABLE" });
      if (first.processing.status !== "PROCESSED") throw Error("not processed");
      const id = first.processing.canonicalVacancyId;
      const vacancy = (await f.deps.canonicalVacancyRepository.findById(id))!;
      expect(vacancy.role.value?.title).toBe("Technicien(ne) SAV France (F/H)");
      expect(vacancy.location.value?.rawText).toBe("Cosse-le-Vivien");
      expect(vacancy.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
      expect(vacancy.compensation.value).toMatchObject({ currency: "EUR", minimum: 30000, maximum: 40000, period: "YEAR" });
      expect(vacancy.workMode.status).toBe("UNKNOWN");
      expect(vacancy.travel).toMatchObject({ status: "RESOLVED", value: { requirement: "REQUIRED", frequency: "FREQUENT" }, conflictingEvidenceIds: [] });
      expect(vacancy.travel.supportingEvidenceIds).toHaveLength(2);
      expect(vacancy.canonicalizationStatus).toBe("USABLE");
      expect(first.processing.employerStatus).toBe("UNRESOLVED_RECORD_CREATED");
      const card = (await f.workflow.getVacancyReview(id)).organizationRoleReview![0]!;
      expect(card).toMatchObject({ name: "Michael Page", recommendedRole: "STAFFING_AGENCY" });
      expect(card.reasons).toContain('The selected vacancy says "Notre client".');
      expect(card.actions.map(x => x.role)).toEqual(["EMPLOYER", "STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY"]);
      const decision = { canonicalVacancyId: id, requestId: "role", identityKey: card.identityKey, role: "EMPLOYER" as const, candidateToken: card.candidateToken };
      await expect(f.workflow.decideVacancyOrganizationRole({ ...decision, acknowledgeContradiction: false })).rejects.toThrow(/requires confirmation/u);
      await f.workflow.decideVacancyOrganizationRole({ ...decision, acknowledgeContradiction: true });
      const rows = f.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const same = await f.runtime.captureAndProcessBrowserVacancy(payload);
      expect(same.capture.observationId).toBe(first.capture.observationId);
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(2);
      const changed = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replace("Expérience en maintenance", "Solide expérience en maintenance") });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: id, observationAdded: true });
      expect(f.db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(rows);
    } finally { f.db.close(); }
  });
});

it.skipIf(!process.env.MICHAEL_PAGE_TECHNICIEN_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays the original capture without changing the source database", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const f = setup();
  try {
    const original = (await new SqliteSourceObservationRepository(disk).findById("34ed1bb4-3d66-4553-9c51-ecc15cdab398"))!;
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const result = await f.runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: original.source.sourceUrl!, html: acquisition.html, pageTitle: acquisition.pageTitle, visibleText: original.rawContent! });
    expect(result.processing).toMatchObject({ status: "PROCESSED", captureAcceptedAsVacancy: true, canonicalizationStatus: "USABLE" });
    if (result.processing.status !== "PROCESSED") throw Error("not processed");
    const vacancy = (await f.deps.canonicalVacancyRepository.findById(result.processing.canonicalVacancyId))!;
    expect(vacancy.role.value?.title).toBe("Technicien(ne) SAV France (F/H)");
    expect(vacancy.location.value?.rawText).toBe("Cosse-le-Vivien");
    expect(vacancy.engagement.value?.normalizedTerms).toEqual(["INDEFINITE"]);
    expect(vacancy.compensation.value).toMatchObject({ currency: "EUR", minimum: 30000, maximum: 40000, period: "YEAR" });
    expect(vacancy.workMode.status).toBe("UNKNOWN");
    const observation = (await f.deps.sourceObservationRepository.findById(result.capture.observationId))!;
    expect(observation.publishedAt).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.travelRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawText: "déplacements réguliers", frequency: "REGULAR" }),
      expect.objectContaining({ rawText: "Déplacements fréquents", frequency: "FREQUENT" }),
    ]));
    expect(vacancy.travel).toMatchObject({ status: "RESOLVED", value: { requirement: "REQUIRED", frequency: "FREQUENT" } });
    expect(vacancy.travel.supportingEvidenceIds).toHaveLength(2);
    expect(vacancy.canonicalizationStatus).toBe("USABLE");
    expect(JSON.stringify(evidence)).not.toMatch(neighbours);
    expect(evidence.organizations.some(x => ["EMPLOYER", "CLIENT"].includes(x.role))).toBe(false);
    expect((await f.workflow.getVacancyReview(vacancy.id)).organizationRoleReview).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Michael Page", recommendedRole: "STAFFING_AGENCY" })]));
  } finally { disk.close(); f.db.close(); }
});
