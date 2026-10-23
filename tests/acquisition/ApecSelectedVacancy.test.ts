import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { ApecSelectedVacancyContextLocator, apecIdentity, apecVacancyId, parseApecSalary } from "../../src/application/acquisition/ApecVacancy.js";
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

const reference = "179627528W";
const companyReference = "2727430";
const apecUrl = `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${reference}?motsCles=m%C3%A9canique&selectedIndex=1&page=0`;
const fixture = readFileSync("tests/fixtures/apecSelectedVacancy.html", "utf8");
const extractor = createVacancyEvidenceExtractor();
const payload = { pageUrl: apecUrl, pageTitle: "Apec", html: fixture, visibleText: "Ingénieur(e) mécanique HELIOS OVA GROUP", capturedAt: "2026-10-23T08:00:00Z" };

function capture(html = fixture, pageUrl = apecUrl) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html, pageUrl }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function project(html = fixture) {
  const { acquisition, observation } = capture(html);
  const evidence = await extractor.extract(observation);
  const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
    canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-23") },
  });
  return { acquisition, observation, evidence, canonical };
}
const locate = (html: string, url = apecUrl) => new ApecSelectedVacancyContextLocator().locate({ providerKey: "APEC", sourceUrl: url, html });
const edit = (from: string | RegExp, to: string) => { const html = fixture.replace(from, to); expect(html).not.toBe(fixture); return html; };

describe("APEC selected vacancy identity", () => {
  it("reads the APEC reference only from the validated detail route", () => {
    expect(apecVacancyId(apecUrl)).toBe(reference);
    expect(apecVacancyId(`https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${reference}/`)).toBe(reference);
    expect(apecVacancyId(`https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${companyReference}`)).toBeUndefined();
    expect(apecVacancyId("https://www.apec.fr/candidat/recherche-emploi.html")).toBeUndefined();
    expect(apecVacancyId(`https://example.com/candidat/recherche-emploi.html/emploi/detail-offre/${reference}`)).toBeUndefined();
  });
  it("verifies the page reference and keeps the company reference out of identity", async () => {
    expect(apecIdentity({ sourceUrl: apecUrl, html: fixture, externalId: reference })).toEqual({ status: "VALID", id: reference, companyReference });
    const { acquisition, evidence } = await project();
    expect(acquisition.externalId).toBe(reference);
    expect(acquisition.contexts?.[0]).toMatchObject({ providerKey: "APEC", providerExternalId: reference, metadata: { apecReference: reference, companyReference } });
    expect([...new Set(evidence.externalIdentifiers.map(item => item.value))]).toEqual([reference]);
    expect(JSON.stringify(evidence.externalIdentifiers)).not.toContain(companyReference);
  });
  it.each([
    ["an apply link for another vacancy", () => edit(`promotion/${reference}`, "promotion/179361200W")],
    ["a selected-page reference that differs from the URL", () => edit(`Ref. Apec : ${reference}`, "Ref. Apec : 179361200W")],
    ["a canonical link for another vacancy", () => edit(`detail-offre/${reference}"></head>`, `detail-offre/179361200W"></head>`)],
  ])("detects conflicting identifiers (%s) and publishes no identity", async (_name, build) => {
    const html = build();
    expect(apecIdentity({ sourceUrl: apecUrl, html, externalId: reference })).toMatchObject({ status: "CONFLICT", identifiers: expect.arrayContaining([reference, "179361200W"]) });
    expect(locate(html)).toBeUndefined();
    const { acquisition } = capture(html);
    expect(acquisition.externalId).toBeUndefined();
    expect(acquisition.contexts ?? []).toEqual([]);
  });
  it("treats the company reference presented as the APEC reference as a conflict", () => {
    const html = edit(`Ref. Apec : ${reference}`, `Ref. Apec : 99999999X`).replace(`Ref. Société : ${companyReference}`, "Ref. Société : 99999999X");
    expect(apecIdentity({ sourceUrl: apecUrl, html, externalId: reference }).status).toBe("CONFLICT");
  });
  it("does not verify a page that shows no reference", () => {
    expect(apecIdentity({ sourceUrl: apecUrl, html: edit(/<div[^>]*class="ref-offre"[\s\S]*?<\/div>/u, ""), externalId: reference }).status).toBe("UNVERIFIED");
  });
});

describe("APEC selected vacancy boundary", () => {
  it("captures one bounded vacancy without navigation, map or recommended jobs", async () => {
    expect(fixture).toMatch(/HELIOS/u);
    expect(fixture).toMatch(/OVA GROUP/u);
    const { acquisition } = capture();
    const context = acquisition.contexts?.[0];
    expect(acquisition.contexts).toHaveLength(1);
    for (const value of [context?.html ?? "", context?.text ?? ""]) {
      expect(value).toContain("Ingénieur(e) mécanique - Systèmes pharmaceutiques F/H");
      expect(value).toContain("Meent Life Sciences");
      expect(value).not.toMatch(/HELIOS|OVA GROUP|179361200W|179566581W|Autres postes|Localisation du poste|leaflet|<nav|<aside/u);
    }
    // The page visible text stays stored as raw content; evidence reads only the bounded context.
  });
  it("projects only the selected vacancy from a page that also lists recommended jobs", async () => {
    const { evidence, canonical } = await project();
    expect(canonical.role.value?.title).toBe("Ingénieur(e) mécanique - Systèmes pharmaceutiques F/H");
    expect(JSON.stringify(evidence)).not.toMatch(/HELIOS|OVA GROUP/u);
    for (const item of [...evidence.vacancyTitles, ...evidence.locations, ...evidence.engagements, ...evidence.compensations, ...evidence.organizations]) expect(item.provenance.contentOrigin).toBe("SELECTED_VACANCY_CONTEXT");
  });
  it.each([
    ["a second article", () => edit("</apec-detail-emploi>", `<article><div class="ref-offre">Ref. Apec : 179361200W</div></article></apec-detail-emploi>`)],
    ["a missing reference block", () => edit(/<div[^>]*class="ref-offre"[\s\S]*?<\/div>/u, "")],
    ["a hidden article", () => edit("<article", `<article hidden`)],
    ["no detail module", () => edit(/apec-detail-emploi/gu, "apec-other-emploi")],
  ])("fails closed on an uncertain boundary (%s) rather than falling back to page content", async (_name, build) => {
    const html = build();
    expect(locate(html)).toBeUndefined();
    const { acquisition, evidence } = await project(html);
    expect(acquisition.contexts ?? []).toEqual([]);
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.compensations).toEqual([]);
    expect(evidence.organizations).toEqual([]);
  });
});

describe("APEC salary normalization", () => {
  it("normalizes the stored range as EUR 50000-55000 per year and preserves the original text", async () => {
    const { acquisition, evidence, observation } = await project();
    expect(observation.salaryText).toBe("50 - 55 k€ brut annuel");
    expect(acquisition.contexts?.[0]?.text).toContain("50 - 55 k€ brut annuel");
    expect(evidence.compensations).toEqual([expect.objectContaining({ rawText: "50 - 55 k€ brut annuel", currency: "EUR", minimum: 50000, maximum: 55000, period: "YEAR",
      provenance: expect.objectContaining({ contentOrigin: "SELECTED_VACANCY_CONTEXT", sourceObservationId: observation.id }) })]);
  });
  it.each([
    ["50 - 55 k€ brut annuel", 50000, 55000, "YEAR"],
    ["60 k€ brut annuel", 60000, 60000, "YEAR"],
    ["45 000 - 52 000 € brut annuel", 45000, 52000, "YEAR"],
    ["3 000 - 3 500 € brut mensuel", 3000, 3500, "MONTH"],
  ])("parses %s", (raw, minimum, maximum, period) => {
    expect(parseApecSalary(raw)).toEqual({ rawText: raw, currency: "EUR", minimum, maximum, period });
  });
  it.each(["Selon profil", "50 - 55 k€", "55 - 50 k€ brut annuel", ""])("does not normalize %j", raw => {
    expect(parseApecSalary(raw)).toBeUndefined();
  });
  it("keeps the original text without numbers when the structured salary disagrees", async () => {
    const { evidence } = await project(edit('"maxValue": "55000.00"', '"maxValue": "65000.00"'));
    expect(evidence.compensations).toHaveLength(1);
    expect(evidence.compensations[0]).toMatchObject({ rawText: "50 - 55 k€ brut annuel" });
    expect(evidence.compensations[0]?.minimum).toBeUndefined();
    expect(evidence.compensations[0]?.maximum).toBeUndefined();
  });
});

describe("APEC displayed company", () => {
  it("records Meent only as the displayed company and infers no employer or agency role", async () => {
    const { evidence, observation } = await project();
    expect(observation.displayedCompanyName).toBe("Meent Life Sciences");
    expect(evidence.organizations.map(item => [item.value, item.role])).toEqual([["Meent Life Sciences", "DISPLAYED_COMPANY"]]);
  });
});

function workflowFor(db: ReturnType<typeof createDatabase>) {
  const clusters = new SqliteEmployerClusterRepository(db);
  const deps = { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
    employerClusterRepository: clusters, employerClusterWriter: clusters, assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
    agencyMemoryRepository: new SqliteConfirmedOrganizationRoleRepository(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db) };
  return { deps, workflow: createVacancyReviewWorkflow(deps) };
}
const count = (db: ReturnType<typeof createDatabase>, table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

describe("APEC recapture and continuity", () => {
  it("reuses the observation for an identical recapture and keeps human decisions", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const { deps, workflow } = workflowFor(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
      const canonicalId = first.processing.canonicalVacancyId;
      expect((await deps.sourceObservationRepository.findById(first.capture.observationId))?.source.externalId).toBe(reference);
      await workflow.confirmVacancyEmployer({ canonicalVacancyId: canonicalId, candidateName: "Meent Life Sciences" });
      const history = db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-23T08:05:00Z" });
      expect(again.capture.observationId).toBe(first.capture.observationId);
      expect(again.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      expect(await deps.sourceObservationRepository.countCaptureOccurrences([first.capture.observationId])).toBe(2);
      expect(count(db, "source_observations")).toBe(1);
      expect(count(db, "canonical_vacancies")).toBe(1);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(history);
      expect((await workflow.getVacancyReview(canonicalId)).employer.confirmationCandidate).toBeNull();
    } finally { db.close(); }
  });

  // A capture made before the reference was recognized has no external ID and no exact identity claim.
  async function legacyState(db: ReturnType<typeof createDatabase>) {
    const runtime = createCaptureProcessingRuntime(db);
    const { deps, workflow } = workflowFor(db);
    const first = await runtime.captureAndProcessBrowserVacancy(payload);
    if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
    db.prepare("DELETE FROM canonical_vacancy_exact_identity_claims").run();
    db.prepare("UPDATE source_observations SET external_id = NULL").run();
    return { runtime, deps, workflow, legacyId: first.capture.observationId, canonicalId: first.processing.canonicalVacancyId };
  }
  it("attaches the identified recapture to the existing canonical vacancy of a capture without external ID", async () => {
    const db = createDatabase(":memory:");
    try {
      const { runtime, deps, workflow, legacyId, canonicalId } = await legacyState(db);
      await workflow.confirmVacancyEmployer({ canonicalVacancyId: canonicalId, candidateName: "Meent Life Sciences" });
      const recaptured = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T08:00:00Z" });
      if (recaptured.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect(recaptured.capture.observationId).not.toBe(legacyId);
      expect(recaptured.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect((await deps.sourceObservationRepository.findById(recaptured.capture.observationId))?.source.externalId).toBe(reference);
      expect(count(db, "canonical_vacancies")).toBe(1);
      expect((await deps.canonicalVacancyRepository.findByExactSourceIdentity("apec.fr", reference))?.id).toBe(canonicalId);
      expect((await workflow.getVacancyReview(canonicalId)).employer.confirmationCandidate).toBeNull();
      const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T09:00:00Z" });
      expect(again.capture.observationId).toBe(recaptured.capture.observationId);
      expect(count(db, "canonical_vacancies")).toBe(1);
    } finally { db.close(); }
  });
  it("does not merge when the earlier capture cannot be re-validated as the same vacancy", async () => {
    const db = createDatabase(":memory:");
    try {
      const { runtime, canonicalId, legacyId } = await legacyState(db);
      const stored = JSON.parse((db.prepare("SELECT metadata_json FROM source_observations WHERE id = ?").get(legacyId) as { metadata_json: string }).metadata_json);
      stored.acquisition.html = stored.acquisition.html.replace(`Ref. Apec : ${reference}`, "Ref. Apec : 179361200W");
      db.prepare("UPDATE source_observations SET metadata_json = ? WHERE id = ?").run(JSON.stringify(stored), legacyId);
      const recaptured = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T08:00:00Z" });
      if (recaptured.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect(recaptured.processing.canonicalVacancyId).not.toBe(canonicalId);
      expect(count(db, "canonical_vacancies")).toBe(2);
    } finally { db.close(); }
  });
  it("does not merge when the earlier capture belongs to a different company reference", async () => {
    const db = createDatabase(":memory:");
    try {
      const { runtime, canonicalId, legacyId } = await legacyState(db);
      const stored = JSON.parse((db.prepare("SELECT metadata_json FROM source_observations WHERE id = ?").get(legacyId) as { metadata_json: string }).metadata_json);
      stored.acquisition.html = stored.acquisition.html.replace(`Ref. Société : ${companyReference}`, "Ref. Société : 1111111");
      db.prepare("UPDATE source_observations SET metadata_json = ? WHERE id = ?").run(JSON.stringify(stored), legacyId);
      const recaptured = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T08:00:00Z" });
      if (recaptured.processing.status !== "PROCESSED") throw Error("Processing failed");
      expect(recaptured.processing.canonicalVacancyId).not.toBe(canonicalId);
    } finally { db.close(); }
  });
});
