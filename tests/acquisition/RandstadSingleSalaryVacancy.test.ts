import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";

// Actual saved page; executable scripts, styling and image assets removed, DOM/JSON-LD retained.
const html = readFileSync("tests/fixtures/randstadSingleSalaryVacancy.html", "utf8");
const url = "https://www.randstad.fr/emploi/ingenieur-conception-mecanique-fh_colomiers_307-u57-r002303_02r/";
const payload = { pageUrl: url, pageTitle: "Randstad", html, visibleText: "Other job: 999999 EUR / YEAR", capturedAt: "2026-10-25T16:00:00Z" };
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function evidence(page = html) { return createVacancyEvidenceExtractor().extract(capture(page).observation); }

describe("Randstad saved single annual salary and recruitment relationship", () => {
  it("preserves EUR 38000 annually without gross/net qualification or structured maxValue=0", async () => {
    const result = await evidence();
    expect(result.compensations).toEqual([{ rawText: "38 000 € par année", currency: "EUR", minimum: 38000, maximum: 38000, period: "YEAR",
      provenance: { sourceObservationId: "observation", extractionMethod: "TEXT_EXTRACTION", confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" } }]);
    expect(result.organizations).toEqual([
      expect.objectContaining({ value: "Randstad France", role: "DISPLAYED_COMPANY" }),
      expect.objectContaining({ value: "Randstad France", role: "RECRUITMENT_AGENCY", provenance: expect.objectContaining({ confidence: 0.98 }) }),
    ]);
    const context = capture().acquisition.contexts![0]!;
    expect(context.text).toContain("Nous recherchons pour le compte de notre client");
    expect(context.text).toContain("jusqu'au suivi de production.");
    expect(context.text).not.toMatch(/999999|postuler en ligne/);
  });
  it.each(["38 000 € par année", "38\u00a0000 € par année", "38\u202f000 € par année", "38000 € par année"])("accepts a single integer annual amount: %s", async salary => {
    expect((await evidence(html.replaceAll("38 000 € par année", salary))).compensations[0]).toMatchObject({ minimum: 38000, maximum: 38000, currency: "EUR", period: "YEAR" });
  });
  it.each(["38 000 €", "38 000 USD par année", "38 00 € par année", "38 000 € par semaine", "38 000 € - 30 000 € par année"])("does not guess unsupported or invalid salary: %s", async salary => {
    expect((await evidence(html.replaceAll("38 000 € par année", salary))).compensations).toEqual([]);
  });
  it.each(["Nous accompagnons notre client", "Randstad est une agence de travail temporaire", "Ce poste est proposé en CDI"])("does not turn company activity, client mentions or CDI into a vacancy role: %s", async replacement => {
    const page = html.replaceAll("Nous recherchons pour le compte de notre client", replacement);
    const result = await evidence(page);
    expect(result.organizations).toEqual([expect.objectContaining({ value: "Randstad France", role: "DISPLAYED_COMPANY" })]);
    expect(result.engagements.flatMap(e => e.normalizedTerms)).toContain("INDEFINITE");
  });
  it("requires matched agency evidence and ignores recruiting/salary claims outside the boundary", async () => {
    const page = html.replaceAll("Nous recherchons pour le compte de notre client", "Notre client") + '<footer>Nous recherchons pour le compte de notre client. Randstad est une agence de travail temporaire. 99 000 € par année</footer>';
    expect((await evidence(page)).organizations.map(o => o.role)).toEqual(["DISPLAYED_COMPANY"]);
    expect((await evidence(html.replace(/<script\b[\s\S]*?<\/script>/giu, ""))).organizations).toEqual([]);
  });
  it("preserves human decisions through identical and changed recapture", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Capture failed");
      const canonicalId = first.processing.canonicalVacancyId;
      db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
        VALUES ('interest',?,'INTERESTED','2026-10-25T16:00:00Z','2026-10-25T16:00:00Z',NULL)`).run(canonicalId);
      db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at)
        VALUES ('role',?,'name:randstad france','Randstad France','randstad france','STAFFING_AGENCY',NULL,'{}',1,'2026-10-25T16:00:00Z')`).run(canonicalId);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T16:01:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replaceAll("38 000 € par année", "39 000 € par année"), capturedAt: "2026-10-25T16:02:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
    } finally { db.close(); }
  });
});

it.skipIf(!process.env.RANDSTAD_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual Randstad observation in memory with original canonical and decisions", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById("63377f35-1da6-4204-9425-5927a0faf575"))!;
    const canonicalId = "4e7a6aa5-1003-4dbe-856e-440f593c113e";
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history();
    // Extraction repairs the immutable original too, not just a freshly mapped observation.
    expect((await createVacancyEvidenceExtractor().extract(original)).compensations[0]).toMatchObject({ minimum: 38000, maximum: 38000, currency: "EUR", period: "YEAR" });
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T17:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(canonical.compensation).toMatchObject({ status: "RESOLVED", value: { rawText: "38 000 € par année", currency: "EUR", minimum: 38000, maximum: 38000, period: "YEAR" } });
    const repaired = (await observations.findById(first.capture.observationId))!;
    const result = await createVacancyEvidenceExtractor().extract(repaired);
    expect(result.organizations).toContainEqual(expect.objectContaining({ value: "Randstad France", role: "RECRUITMENT_AGENCY", provenance: expect.objectContaining({ confidence: 0.98 }) }));
    expect(result.organizations.some(o => ["STAFFING_AGENCY", "EMPLOYER", "CLIENT"].includes(o.role))).toBe(false);
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T17:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(history()).toEqual(after);
    expect(await observations.findById(original.id)).toEqual(original);
  } finally { db.close(); }
});
