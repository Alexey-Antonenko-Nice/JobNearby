import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { evidenceExtractionInputFor } from "../../src/application/vacancies/processVacancyObservation.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { IndeedSelectedVacancyEvidenceExtractor } from "../../src/application/evidence/IndeedSelectedVacancyEvidenceExtractor.js";
import { fromSelectedVacancyContext } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

// Actual saved page (observation 479143cf-a2e7-42ce-9cb7-1c328e13057a).
const base = "tests/fixtures/indeedSapianSelectedPane";
const meta = JSON.parse(readFileSync(`${base}.meta.json`, "utf8")) as { pageUrl: string; pageTitle: string };
const html = readFileSync(`${base}.html`, "utf8");
const payload = { ...meta, html, visibleText: readFileSync(`${base}.visible.txt`, "utf8"), capturedAt: "2026-10-26T06:46:00.000Z" };

function capture() {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage(payload, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

async function evidenceOf() {
  return createVacancyEvidenceExtractor().extract(evidenceExtractionInputFor(capture().observation));
}

async function indeedOnly(text: string) {
  const { acquisition, observation } = capture();
  const context = acquisition.contexts![0]!;
  return new IndeedSelectedVacancyEvidenceExtractor().extract(fromSelectedVacancyContext(observation, { ...context, text }));
}

describe("Indeed selected pane: Sapian", () => {
  it("keeps the supported facts and adds location and partial telework", async () => {
    const { acquisition } = capture();
    expect(acquisition.externalId).toBe("469914f6362f9354");
    const evidence = await evidenceOf();
    expect([...new Set(evidence.vacancyTitles.map(v => v.value))]).toEqual(["Assistant Technique (H/F)"]);
    expect([...new Set(evidence.locations.map(l => l.value))]).toEqual(["23 Rue Saglio, 67100 Strasbourg"]);
    expect([...new Set(evidence.workModes.map(w => w.value))]).toEqual(["HYBRID"]);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(expect.arrayContaining(["INDEFINITE", "FULL_TIME"]));
    expect(evidence.compensations[0]).toMatchObject({ currency: "EUR", minimum: 22000, maximum: 27000, period: "YEAR" });
  });

  it("never reads partial telework as fully remote", async () => {
    const evidence = await evidenceOf();
    expect(evidence.workModes.some(w => w.value === "REMOTE")).toBe(false);
    const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({
      canonicalVacancyId: "canonical", observations: [capture().observation], extractedEvidence: [evidence],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-10-26") },
    });
    expect(canonical.workMode.value).toBe("HYBRID");
    expect(canonical.remoteEligibleCountries.value ?? []).toEqual([]);
    expect(canonical.location.value?.rawText).toBe("23 Rue Saglio, 67100 Strasbourg");
  });

  it("classifies Sapian as employer only because the vacancy text identifies it", async () => {
    const evidence = await evidenceOf();
    expect(evidence.organizations).toEqual([expect.objectContaining({ value: "Sapian", role: "EMPLOYER" })]);
    const text = capture().acquisition.contexts![0]!.text!;
    expect(text).toContain("Nous sommes SAPIAN");
    expect((await indeedOnly(text.replace("Nous sommes SAPIAN", "Voici SAPIAN"))).organizations[0]?.role).toBe("UNKNOWN");
    expect((await indeedOnly(text.replace("Nous sommes SAPIAN", "Nous sommes OTHERCO"))).organizations[0]?.role).toBe("UNKNOWN");
    expect((await indeedOnly(text.replace("nous recherchons", "notre client recherche"))).organizations[0]?.role).toBe("UNKNOWN");
    expect((await indeedOnly(text + "\nPour le compte de notre client")).organizations[0]?.role).toBe("UNKNOWN");
  });

  it("does not read facts from the description", async () => {
    const text = capture().acquisition.contexts![0]!.text!;
    const injected = text.replace("Description du poste\n", "Description du poste\n12 Rue Faux, 75001 Paris\nTélétravail partiel\n");
    expect((await indeedOnly(injected)).locations.map(l => l.value)).toEqual(["23 Rue Saglio, 67100 Strasbourg"]);
    const noTelework = text.replaceAll("Télétravail partiel", "Sur site");
    expect((await indeedOnly(noTelework)).workModes).toEqual([]);
  });
});

// Opt-in: reads the saved database once; everything runs on a private in-memory copy.
it.skipIf(!process.env.INDEED_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays the stored Indeed capture into the same canonical and preserves human state", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observationId = "479143cf-a2e7-42ce-9cb7-1c328e13057a", canonicalId = "f35fbe4b-cb8f-440c-9de6-efdbbcbfa74c";
    const original = (await new SqliteSourceObservationRepository(db).findById(observationId))!;
    expect((original.metadata.acquisition as { html: string }).html).toBe(html);
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
      VALUES ('human-interest',?,'INTERESTED','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z',NULL)`).run(canonicalId);
    const stateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const state = () => stateTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = state();
    const clusters = () => db.prepare("SELECT id, status, algorithm FROM observation_cluster_assignments ORDER BY id").all();
    const clustersBefore = clusters();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    const canonicalsBefore = count("canonical_vacancies"), observationsBefore = count("source_observations");
    const runtime = createCaptureProcessingRuntime(db);
    const first = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-27T08:00:00.000Z" });
    expect(first.capture.observationId).toBe(observationId);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
    const again = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-27T08:05:00.000Z" });
    expect(again.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(count("canonical_vacancies")).toBe(canonicalsBefore);
    expect(count("source_observations")).toBe(observationsBefore);
    expect(state()).toEqual(before);
    expect(clusters()).toEqual(clustersBefore);
    const fields = JSON.stringify(db.prepare("SELECT field_name, status, value_json FROM canonical_vacancy_fields WHERE canonical_vacancy_id = ?").all(canonicalId));
    expect(fields).toMatch(/Saglio/u);
    expect(fields).toMatch(/HYBRID/u);
    expect(fields).toMatch(/22000/u);
  } finally {
    db.close();
  }
});
