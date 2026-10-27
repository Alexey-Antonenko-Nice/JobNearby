import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { evidenceExtractionInputFor } from "../../src/application/vacancies/processVacancyObservation.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { FranceTravailVacancyEvidenceExtractor } from "../../src/application/evidence/FranceTravailVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

function load(base: string) {
  const meta = JSON.parse(readFileSync(`${base}.meta.json`, "utf8")) as { pageUrl: string; pageTitle: string };
  return { ...meta, html: readFileSync(`${base}.html`, "utf8"), visibleText: readFileSync(`${base}.visible.txt`, "utf8") };
}

// Actual saved pages: 250bb3a8… (description component empty) and 7b7d204f… (shadow DOM serialized).
const unrendered = load("tests/fixtures/franceTravailUnrenderedDetail");
const real = load("tests/fixtures/franceTravailRenderedDetail");
const payload = { ...real, capturedAt: "2026-10-25T06:26:23.702Z" };

function capture(page = real.html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

async function evidenceOf(page = real.html) {
  return createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(capture(page).observation));
}

describe("France Travail selected vacancy from the real shadow-DOM capture", () => {
  it("shows the earlier capture was only the pane header", () => {
    const text = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(
      { ...unrendered, capturedAt: "2026-10-25T06:05:17.232Z" }, "acquisition").contexts![0]!.text!;
    expect(text.length).toBeLessThan(700);
    expect(text).not.toMatch(/Critères|Salaire/u);
  });

  it("includes the full description, criteria and employer panel but not background results", () => {
    const { acquisition } = capture();
    expect(acquisition.externalId).toBe("213CWRC");
    const text = acquisition.contexts![0]!.text!;
    expect(text.length).toBeGreaterThan(4000);
    for (const part of ["La mission d'un vendeur-concepteur", "Voiture de fonction", "Critères de l’offre",
      "Salaire Annuel de 24000.0 Euros à 55000.0 Euros", "L'employeur\nMOBALPA", "Actualisée le 12 octobre 2026"]) {
      expect(text).toContain(part);
    }
    expect(text).not.toMatch(/OPERA DU RHIN|O\.T\.E\.|COBOL|FAYAT|COLLECTIVE\.WORK|Trier par|66 offres pour/u);
  });

  it("extracts title, location, contract, salary and displayed company", async () => {
    const evidence = await evidenceOf();
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Vendeur-Concepteur en Aménagement Intérieur H/F"]);
    expect(evidence.locations.map(l => l.value).join("|")).toMatch(/OSTWALD/u);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toContain("INDEFINITE");
    expect(evidence.compensations).toHaveLength(1);
    expect(evidence.compensations[0]).toMatchObject({ currency: "EUR", minimum: 24000, maximum: 55000, period: "YEAR" });
    expect(evidence.compensations[0]!.rawText).toContain("Salaire Annuel de 24000.0 Euros à 55000.0 Euros");
    expect(evidence.compensations[0]!.rawText).toMatch(/entre 24K€ et 55K€ annuel.*fixe et d'une variable/u);
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "MOBALPA", role: "DISPLAYED_COMPANY" })]);
  });

  it("does not confirm an employer or record a publication date", async () => {
    const { observation } = capture();
    const evidence = await evidenceOf();
    expect(evidence.organizations.some(o => o.role === "EMPLOYER")).toBe(false);
    expect(JSON.stringify(evidence)).not.toMatch(/Actualis|2026-10-12|publi/iu);
    const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
      canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-25") },
    });
    expect(canonical.organizationRelationships.filter(r => r.role === "EMPLOYER")).toEqual([]);
    expect(canonical.compensation.value).toMatchObject({ minimum: 24000, maximum: 55000 });
    expect(canonical.compensation.value?.rawText).toMatch(/fixe et d'une variable/u);
  });

  it("ignores background results and unrelated offers", async () => {
    expect(JSON.stringify(await evidenceOf())).not.toMatch(/OPERA DU RHIN|O\.T\.E\.|Profession libérale|COBOL|215FWVQ/u);
  });

  it("parses other numeric formats and refuses other offers' panels", async () => {
    const { acquisition, observation } = capture();
    const context = acquisition.contexts![0]!;
    const extract = (text: string, providerKey: "FRANCE_TRAVAIL" | "LINKEDIN" = "FRANCE_TRAVAIL") => new FranceTravailVacancyEvidenceExtractor().extract(
      fromSelectedVacancyContext(observation, { ...context, providerKey, text }));
    const monthly = await extract("Salaire Mensuel de 2 500,50 Euros à 3.200 Euros\nL’employeur\nACME");
    expect(monthly.compensations[0]).toMatchObject({ minimum: 2500.5, maximum: 3200, period: "MONTH" });
    expect(monthly.organizations[0]).toMatchObject({ value: "ACME", role: "DISPLAYED_COMPANY" });
    const single = await extract("Salaire: Horaire de 12,5 Euros");
    expect(single.compensations[0]).toMatchObject({ minimum: 12.5, period: "HOUR" });
    expect(single.compensations[0]!.maximum).toBeUndefined();
    expect((await extract("Salaire Annuel de 24000.0 Euros", "LINKEDIN")).compensations).toEqual([]);
    expect((await extract("L'employeur\nSecteur d'activité Commerce")).organizations[0]?.value).toBe("Secteur d'activité Commerce");
  });
});

// Opt-in: reads the saved database once; everything runs on a private in-memory copy.
it.skipIf(!process.env.FRANCETRAVAIL_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays the real France Travail capture into the same canonical and preserves human state", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close(); migrateDatabase(db);
  try {
    const observationId = "7b7d204f-b2f0-4456-a842-3c843499127e", canonicalId = "3659bdb1-88b7-4140-9b66-a72d84485bfc";
    const original = (await new SqliteSourceObservationRepository(db).findById(observationId))!;
    expect((original.metadata.acquisition as { html: string }).html).toBe(real.html);
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
      VALUES ('human-interest',?,'INTERESTED','2026-10-25T00:00:00Z','2026-10-25T00:00:00Z',NULL)`).run(canonicalId);
    const stateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const state = () => stateTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = state();
    const clusters = () => db.prepare("SELECT a.id, a.status, a.algorithm FROM observation_cluster_assignments a ORDER BY a.id").all();
    const clustersBefore = clusters();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    const canonicalsBefore = count("canonical_vacancies"), observationsBefore = count("source_observations");
    const runtime = createCaptureProcessingRuntime(db);
    const first = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-26T08:00:00.000Z" });
    expect(first.capture.observationId).toBe(observationId);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
    const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-26T08:05:00.000Z" });
    expect(again.capture.observationId).toBe(observationId);
    expect(again.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(count("canonical_vacancies")).toBe(canonicalsBefore);
    expect(count("source_observations")).toBe(observationsBefore);
    expect(state()).toEqual(before);
    expect(clusters()).toEqual(clustersBefore);
    const canonical = db.prepare("SELECT * FROM canonical_vacancy_fields WHERE canonical_vacancy_id = ?").all(canonicalId);
    expect(JSON.stringify(canonical)).toMatch(/24000/u);
  } finally {
    db.close();
  }
});
