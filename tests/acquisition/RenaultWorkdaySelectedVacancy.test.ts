import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { RenaultSelectedVacancyContextLocator, renaultVacancyId } from "../../src/application/acquisition/RenaultWorkdayVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";

const html = readFileSync("tests/fixtures/renaultWorkdaySelectedVacancy.html", "utf8");
const url = "https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/job/Aubevoye/CS27---BAC-5---Stage-ingnieur-digitalisation-mtier-synthse-prestation-vhicules-H-F_JOBREQ_50273077/";
const title = "CS27 – BAC+5 – Stage ingénieur digitalisation métier synthèse prestation véhicules H/F";
const payload = { pageUrl: url, pageTitle: title, html, visibleText: "Navigation Other Company Remote 90000 EUR / YEAR page is loaded", capturedAt: "2026-10-24T21:24:46.162Z" };
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  const observation = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation");
  return { acquisition, observation };
}
function locate(page = html, sourceUrl = url, externalId?: string) { return new RenaultSelectedVacancyContextLocator().locate({ providerKey: "RENAULT_WORKDAY", html: page, sourceUrl, ...(externalId ? { externalId } : {}) }); }
describe("Renault validated Workday tenant", () => {
  it("captures bounded heading, facts and complete description; keeps structured and displayed evidence distinct", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("JOBREQ_50273077");
    expect(observation.publishedAt?.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    const context = acquisition.contexts?.[0];
    expect(context?.text).toContain("Politique Groupe de protection des données personnelles");
    expect(context?.text).toContain("Anglais requis");
    expect(context?.text).not.toMatch(/page is loaded|réinvente la mobilité|futuREady|Connexion|Candidature Spontanée|Other Company/);
    expect(context?.metadata).toMatchObject({ branding: "Renault Group", displayedLocation: "Aubevoye",
      structuredLocation: { address: { addressCountry: "France", addressLocality: "FR_REN_RSAS - Aubevoye (Guyancourt)" } },
      publicationRelativeText: "Offre publiée il y a 2 jours", applicationDeadlineText: "Date de fin : 31 mars 2027 (Il reste plus de 30 jours pour postuler)", datePosted: "2026-10-22", validThrough: "2027-03-31" });
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual([title]);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "RENAULT s.a.s.", role: "EMPLOYER" }));
    expect(evidence.organizations.some(o => /Careers|Renault Group/.test(o.value))).toBe(false);
    expect(evidence.locations.map(l => l.value)).toEqual(["Aubevoye"]);
    expect(evidence.languageRequirements).toContainEqual(expect.objectContaining({ language: "English", requirement: "REQUIRED" }));
    const canonical = new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({ canonicalVacancyId: "canonical", observations: [observation], extractedEvidence: [evidence], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date() } });
    expect(canonical.role.value?.title).toBe(title);
    expect(canonical.location.value?.rawText).toBe("Aubevoye");
    expect(canonical.engagement).toMatchObject({ status: "RESOLVED", value: { normalizedTerms: ["FULL_TIME", "INTERNSHIP"] } });
    expect(canonical.workMode.status).toBe("UNKNOWN"); expect(canonical.compensation.status).toBe("UNKNOWN");
  });
  it.each([
    [">JOBREQ_50273077</dd>", ">JOBREQ_99999999</dd>"],
    ['"value" : "JOBREQ_50273077"', '"value" : "JOBREQ_99999999"'],
    ['JOBREQ_50273077//apply', 'JOBREQ_99999999//apply'],
    ['JOBREQ_50273077">', 'JOBREQ_99999999">'],
  ])("rejects disagreement: %s", async (before, after) => {
    expect(html).toContain(before);
    const page = html.replace(before, after);
    expect(locate(page)).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract({ ...capture(page).observation, title: "Stale title", locationText: "Paris", contractText: "Full time", displayedCompanyName: "Stale company" });
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.organizations).toEqual([]);
  });
  it("checks supplied identity, duplicate headings and incomplete description", () => {
    expect(locate(html, url, "JOBREQ_99999999")).toBeUndefined();
    expect(locate(html.replace('data-automation-id="jobPostingDescription"', 'data-automation-id="missing"'))).toBeUndefined();
    expect(locate(html.replace('</h2>', '</h2><h2 data-automation-id="jobPostingHeader">Other job</h2>'))).toBeUndefined();
  });
  it.each([url.replace("alliancewd", "other"), url.replace("renault-group-careers", "other-careers"), url.replace("fr-FR", "en-US"), url.replace("/job/", "/details/"), url.replace("JOBREQ_50273077", "JR100451")])("does not extend the grammar to %s", source => {
    expect(renaultVacancyId(source)).toBeUndefined(); expect(locate(html, source)).toBeUndefined();
  });
  it("ignores unrelated sidebar jobs and misleading outer facts", () => {
    const page = html.replace('data-automation-id="jobSidebar">', 'data-automation-id="jobSidebar"><h2 data-automation-id="jobPostingHeader">Other job</h2><a href="/fr-FR/renault-group-careers/job/Other_JOBREQ_123">Other job</a>');
    expect(locate(page)?.text).toEqual(locate()?.text);
  });
  it("revalidates legacy full-page projections without mutating the observation", async () => {
    const { externalId: _externalId, ...legacySource } = capture().observation.source;
    const old = { ...capture().observation, source: legacySource, title: "page is loaded", displayedCompanyName: "Careers | Renault Group", locationText: "Wrong", contractText: "OTHER" };
    const before = structuredClone(old);
    const evidence = await createVacancyEvidenceExtractor().extract(old);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual([title]); expect(old).toEqual(before);
  });
  it("keeps canonical continuity from an unidentified capture and deduplicates identical recapture", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Initial capture failed");
      db.prepare("UPDATE source_observations SET external_id = NULL WHERE id = ?").run(first.capture.observationId);
      db.prepare("DELETE FROM canonical_vacancy_exact_identity_claims").run();
      // Seed deliberate human state in this disposable database, including a
      // choice different from the provider recommendation.
      db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at)
        VALUES ('human-role',?,'name:renault s.a.s.','RENAULT s.a.s.','renault s.a.s.','CLIENT',NULL,'{}',1,'2026-10-24T21:30:00Z')`).run(first.processing.canonicalVacancyId);
      db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
        VALUES ('human-interest',?,'INTERESTED','2026-10-24T21:30:00Z','2026-10-24T21:30:00Z',NULL)`).run(first.processing.canonicalVacancyId);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const repaired = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T22:00:00Z" });
      expect(repaired.processing).toMatchObject({ canonicalVacancyId: first.processing.canonicalVacancyId });
      const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-24T22:01:00Z" });
      expect(repeated.capture.observationId).toBe(repaired.capture.observationId);
      expect(repeated.processing).toMatchObject({ canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: false });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replaceAll("Prendre en compte les retours utilisateurs.", "Prendre en compte tous les retours utilisateurs."), capturedAt: "2026-10-24T22:02:00Z" });
      expect(changed.capture.observationId).not.toBe(repaired.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: true });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
    } finally { db.close(); }
  });
});

// Opt-in local replay reads the actual saved database once, then operates only
// on a private in-memory copy. No source schema or data can be modified.
it.skipIf(!process.env.RENAULT_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual stored observation and preserves its canonical and decisions", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const id = "9bdc9cd9-56f0-444a-9938-1afb39bb5907", canonicalId = "68a6d5cf-a4f4-4f4a-86c5-830726badbf6";
    const original = (await observations.findById(id))!;
    expect(original).not.toBeNull();
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const decisionTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'observation_cluster_assignments' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const decisions = () => decisionTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = decisions();
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-24T22:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const repaired = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(repaired.role.value?.title).toBe(title); expect(repaired.location.value?.rawText).toBe("Aubevoye");
    expect(repaired.engagement.value?.normalizedTerms).toEqual(["FULL_TIME", "INTERNSHIP"]);
    expect(repaired.compensation.status).toBe("UNKNOWN"); expect(repaired.workMode.status).toBe("UNKNOWN");
    const afterRepair = decisions();
    for (const [name, rows] of before) expect(afterRepair.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows as unknown[]));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-24T22:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(decisions()).toEqual(afterRepair);
    expect(await observations.findById(id)).toEqual(original);
  } finally { db.close(); }
});
