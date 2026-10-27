import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { evidenceExtractionInputFor } from "../../src/application/vacancies/processVacancyObservation.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExplicitCandidateRequirementsExtractor } from "../../src/application/evidence/ExplicitCandidateRequirementsExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import { LinkedInSelectedVacancyEvidenceExtractor } from "../../src/application/evidence/LinkedInSelectedVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

// Actual saved page (observation 2f32a550-3db4-4327-855e-258493de6c5a).
const html = readFileSync("tests/fixtures/linkedinBHiveSelectedPane.html", "utf8");
const visibleText = readFileSync("tests/fixtures/linkedinBHiveSelectedPane.visible.txt", "utf8");
const meta = JSON.parse(readFileSync("tests/fixtures/linkedinBHiveSelectedPane.meta.json", "utf8")) as { pageUrl: string; pageTitle: string };
const payload = { ...meta, html, visibleText, capturedAt: "2026-10-26T08:00:00.000Z" };

// Actual saved capture scrolled to the description (observation a103963f-909d-4d96-a32e-501e3e598d16).
const scrolledHtml = readFileSync("tests/fixtures/linkedinBHiveScrolledAbout.html", "utf8");
const scrolledPayload = { ...JSON.parse(readFileSync("tests/fixtures/linkedinBHiveScrolledAbout.meta.json", "utf8")) as typeof meta, html: scrolledHtml, visibleText: readFileSync("tests/fixtures/linkedinBHiveScrolledAbout.visible.txt", "utf8"), capturedAt: "2026-10-27T07:00:00.000Z" };

describe("LinkedIn B-Hive capture scrolled to the about section", () => {
  const scrolled = () => {
    const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(scrolledPayload, "acquisition");
    return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
  };

  it("starts at the section heading and emits no title or company from it", async () => {
    const { acquisition, observation } = scrolled();
    expect(acquisition.externalId).toBe("4483547375");
    expect(acquisition.contexts![0]!.text!.startsWith("À propos de l’offre d’emploi")).toBe(true);
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));
    expect(evidence.vacancyTitles).toEqual([]);
    expect(evidence.organizations).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/Dans le cadre|À propos de l/u);
  });

  it("keeps the explicit English requirement and infers no client or agency", async () => {
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(scrolled().observation));
    expect(evidence.languageRequirements.map(l => `${l.language}:${l.requirement}`)).toContain("English:REQUIRED");
    expect(evidence.experienceRequirements).toEqual([]);
    expect(evidence.organizations.some(o => o.role !== "DISPLAYED_COMPANY")).toBe(false);
  });

  it("does not let the two shapes conflict on the canonical role", async () => {
    const extract = (observation: ReturnType<typeof capture>["observation"]) => createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));
    const mapper = new DeterministicAcquisitionCaptureMapper();
    const first = mapper.toSourceObservation(new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload, "a1"), "obs-1");
    const second = mapper.toSourceObservation(new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(scrolledPayload, "a2"), "obs-2");
    const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
      canonicalVacancyId: "canonical", observations: [first, second], extractedEvidence: [await extract(first), await extract(second)],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-27") },
    });
    expect(canonical.role.status).toBe("RESOLVED");
    expect(canonical.role.value?.title).toBe("Ingénieur conception mécanique expérimenté F/H");
    expect(canonical.organizationRelationships.filter(r => r.rawName === "B-Hive Engineering").map(r => r.role)).toEqual(["DISPLAYED_COMPANY"]);
  });

  it("rejects section labels and prose as company or title", async () => {
    const { acquisition, observation } = scrolled();
    const context = acquisition.contexts![0]!;
    const run = (text: string) => new LinkedInSelectedVacancyEvidenceExtractor().extract(fromSelectedVacancyContext(observation, { ...context, html: "", text }));
    for (const text of ["À propos de l’offre d’emploi\nIngénieur conception mécanique", "About the job\nIngénieur H/F confirmé", "Description\nTechnicien de maintenance H/F"]) {
      const evidence = await run(text);
      expect(evidence.organizations).toEqual([]);
      expect(evidence.vacancyTitles).toEqual([]);
    }
    const sentence = await run("B-Hive Engineering\nDans le cadre de notre développement, nous recherchons un Ingénieur H/F.\nStrasbourg · il y a 2 jours");
    expect(sentence.vacancyTitles).toEqual([]);
    const header = await run("B-Hive Engineering\nIngénieur conception mécanique expérimenté F/H\nStrasbourg · il y a 2 jours");
    expect(header.vacancyTitles.map(t => t.value)).toEqual(["Ingénieur conception mécanique expérimenté F/H"]);
    expect(header.organizations.map(o => o.value)).toEqual(["B-Hive Engineering"]);
  });
});

function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

const contamination = `<div data-testid="job-card-contamination">
  <a href="https://www.linkedin.com/jobs/view/1111111111/">Chef de projet</a><p>Lyon, France</p>
  <p>Vous maîtrisez l'allemand courant</p><p>Diplôme Bac+5 exigé, 8 ans d'expérience</p>
  <p>Vous correspondez à ce profil : Compétences manquantes Python</p><p>Premium</p></div>`;

describe("LinkedIn B-Hive selected vacancy", () => {
  it("keeps the supported facts and provider ID", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("4483547375");
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));
    expect(new Set(evidence.vacancyTitles.map(v => v.value))).toEqual(new Set(["Ingénieur conception mécanique expérimenté F/H"]));
    expect(new Set(evidence.locations.map(l => l.value))).toEqual(new Set(["Strasbourg, Grand Est, France"]));
    expect(new Set(evidence.workModes.map(w => w.value))).toEqual(new Set(["HYBRID"]));
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toContain("FULL_TIME");
    expect(evidence.compensations[0]).toMatchObject({ minimum: 35000, maximum: 40000, period: "YEAR" });
  });

  it("extracts English as an explicit requirement and invents nothing else", async () => {
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(capture().observation));
    expect(new Set(evidence.languageRequirements.map(l => `${l.language}:${l.requirement}`))).toEqual(new Set(["English:REQUIRED"]));
    expect(evidence.languageRequirements[0]?.rawText).toMatch(/anglais professionnel/iu);
    // "expérimenté" and "de l'expérience en…" state no number of years.
    expect(evidence.experienceRequirements).toEqual([]);
  });

  it("keeps the employer role unknown without naming a client", async () => {
    const { observation } = capture();
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(observation));
    const roles = new Set(evidence.organizations.map(o => o.role));
    expect(roles.has("EMPLOYER")).toBe(false);
    expect(roles.has("CLIENT")).toBe(false);
    expect(roles.has("STAFFING_AGENCY")).toBe(false);
    expect(evidence.organizations.some(o => /B-Hive Engineering/iu.test(o.value) && o.role === "DISPLAYED_COMPANY")).toBe(true);
    const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
      canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-26") },
    });
    expect(canonical.languageRequirements.value).toEqual([expect.objectContaining({ language: "English", requirement: "REQUIRED" })]);
    expect(canonical.organizationRelationships.filter(r => ["EMPLOYER", "CLIENT", "STAFFING_AGENCY"].includes(r.role))).toEqual([]);
  });

  it("does not take requirements from other cards or the profile-match panel", async () => {
    const clean = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(capture().observation));
    const polluted = capture(html.replace(/<body[^>]*>/iu, match => `${match}${contamination}`));
    const evidence = await createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(polluted.observation));
    expect(evidence.languageRequirements.map(l => l.language)).toEqual(clean.languageRequirements.map(l => l.language));
    expect(evidence.experienceRequirements).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/allemand|Bac\+5|8 ans|Chef de projet|Python/u);
  });

  it("does not turn hedged or other-section language wording into a requirement", async () => {
    const { acquisition, observation } = capture();
    const context = acquisition.contexts![0]!;
    const run = (text: string) => new ExplicitCandidateRequirementsExtractor().extract(fromSelectedVacancyContext(observation, { ...context, text }));
    const statement = "Vous maîtrisez l'anglais professionnel";
    expect(context.text).toContain(statement);
    expect((await run(context.text!)).languageRequirements.map(l => l.requirement)).toEqual(["REQUIRED"]);
    const hedged = await run(context.text!.replace(statement, `${statement}, serait un plus`));
    expect(hedged.languageRequirements.every(l => l.requirement !== "REQUIRED")).toBe(true);
    const marketing = await run(`Pourquoi B-HIVE ?\n${statement}\nVotre profil ?\nCAO`);
    expect(marketing.languageRequirements.every(l => l.requirement !== "REQUIRED")).toBe(true);
  });
});

// Opt-in: reads the saved database once; everything runs on a private in-memory copy.
it.skipIf(!process.env.LINKEDIN_BHIVE_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays both stored B-Hive captures into the same canonical with no role conflict", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close(); migrateDatabase(db);
  try {
    const firstId = "2f32a550-3db4-4327-855e-258493de6c5a", latestId = "a103963f-909d-4d96-a32e-501e3e598d16", canonicalId = "60003e74-1ad4-4e66-9d29-e0e4be961792";
    const observations = new SqliteSourceObservationRepository(db);
    expect(((await observations.findById(latestId))!.metadata.acquisition as { html: string }).html).toBe(scrolledHtml);
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
      VALUES ('human-interest-2',?,'INTERESTED','2026-10-27T00:00:00Z','2026-10-27T00:00:00Z',NULL)`).run(canonicalId);
    const stateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const state = () => stateTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = state();
    const clusterSql = "SELECT a.id, a.source_observation_id, a.employer_cluster_id, a.status, a.algorithm FROM observation_cluster_assignments a WHERE source_observation_id IN (?, ?) ORDER BY a.id";
    const clusterBefore = db.prepare(clusterSql).all(firstId, latestId);
    const counts = () => [db.prepare("SELECT COUNT(*) AS n FROM canonical_vacancies").get(), db.prepare("SELECT COUNT(*) AS n FROM source_observations").get()];
    const countsBefore = counts();
    const runtime = createCaptureProcessingRuntime(db);
    const scrolled = await runtime.captureAndProcessBrowserVacancy({ ...scrolledPayload, capturedAt: "2026-10-27T09:00:00Z" });
    expect(scrolled.capture.observationId).toBe(latestId);
    expect(scrolled.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
    const full = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-27T09:01:00Z" });
    expect(full.capture.observationId).toBe(firstId);
    expect(full.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    const repaired = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(repaired.role.status).toBe("RESOLVED");
    expect(repaired.role.value?.title).toBe("Ingénieur conception mécanique expérimenté F/H");
    expect(repaired.location.value?.rawText).toBe("Strasbourg, Grand Est, France");
    expect(repaired.languageRequirements.value).toEqual([expect.objectContaining({ language: "English", requirement: "REQUIRED" })]);
    expect(repaired.organizationRelationships.filter(r => r.rawName === "B-Hive Engineering").map(r => r.role)).toEqual(["DISPLAYED_COMPANY"]);
    expect(repaired.organizationRelationships.some(r => /propos/iu.test(r.rawName ?? ""))).toBe(false);
    expect(repaired.organizationRelationships.filter(r => ["CLIENT", "STAFFING_AGENCY", "RECRUITMENT_AGENCY"].includes(r.role))).toEqual([]);
    // The only EMPLOYER link is the existing unresolved cluster; no employer name is asserted.
    expect(repaired.organizationRelationships.filter(r => r.role === "EMPLOYER").map(r => [r.rawName, r.employerClusterId])).toEqual([[undefined, "d653cc4b-a747-47b1-8f2c-b5a6c323254f"]]);
    expect(db.prepare("SELECT status FROM employer_clusters WHERE id = 'd653cc4b-a747-47b1-8f2c-b5a6c323254f'").get()).toEqual({ status: "UNRESOLVED" });
    expect(counts()).toEqual(countsBefore);
    expect(db.prepare(clusterSql).all(firstId, latestId)).toEqual(clusterBefore);
    expect(state()).toEqual(before);
  } finally { db.close(); }
});

// Opt-in: reads the saved database once; everything runs on a private in-memory copy.
it.skipIf(!process.env.LINKEDIN_BHIVE_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays the stored B-Hive capture into the same canonical and preserves human state", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close(); migrateDatabase(db);
  try {
    const observationId = "2f32a550-3db4-4327-855e-258493de6c5a", canonicalId = "60003e74-1ad4-4e66-9d29-e0e4be961792";
    const original = (await new SqliteSourceObservationRepository(db).findById(observationId))!;
    expect((original.metadata.acquisition as { html: string }).html).toBe(html);
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
      VALUES ('human-interest',?,'INTERESTED','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z',NULL)`).run(canonicalId);
    const stateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const state = () => stateTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = state();
    const clusterSql = "SELECT a.id, a.status, a.algorithm FROM observation_cluster_assignments a WHERE source_observation_id = ?";
    const clusterBefore = db.prepare(clusterSql).all(observationId);
    const counts = () => [db.prepare("SELECT COUNT(*) AS n FROM canonical_vacancies").get(), db.prepare("SELECT COUNT(*) AS n FROM source_observations").get()];
    const countsBefore = counts();
    const runtime = createCaptureProcessingRuntime(db);
    const first = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-26T09:00:00Z" });
    expect(first.capture.observationId).toBe(observationId);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const repaired = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(repaired.role.value?.title).toBe("Ingénieur conception mécanique expérimenté F/H");
    expect(repaired.location.value?.rawText).toBe("Strasbourg, Grand Est, France");
    expect(repaired.workMode.value).toBe("HYBRID");
    expect(repaired.engagement.value?.normalizedTerms).toContain("FULL_TIME");
    expect(repaired.languageRequirements.value).toEqual([expect.objectContaining({ language: "English", requirement: "REQUIRED" })]);
    expect(counts()).toEqual(countsBefore);
    expect(db.prepare(clusterSql).all(observationId)).toEqual(clusterBefore);
    expect(state()).toEqual(before);
    const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-26T09:01:00Z" });
    expect(again.capture.observationId).toBe(observationId);
    expect(again.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(counts()).toEqual(countsBefore);
    expect(state()).toEqual(before);
  } finally { db.close(); }
});
