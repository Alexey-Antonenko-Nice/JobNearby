import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { MichaelPageSelectedVacancyContextLocator, michaelPageFacts, michaelPageVacancyId } from "../../src/application/acquisition/MichaelPageVacancy.js";
import { adeccoElementsWithClass as elements } from "../../src/application/acquisition/AdeccoSelectedVacancyContextLocator.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";

const html = readFileSync("tests/fixtures/michaelPageSelectedVacancy.html", "utf8");
const url = "https://www.michaelpage.fr/job-detail/ing%C3%A9nieur-conception-m%C3%A9canique-hf/ref/jn-082026-7089819";
const title = "Ingénieur Conception Mécanique H/F";
const article = elements(html, "job-advert")[0]!;
const payload = { pageUrl: url, pageTitle: title, html, visibleText: "Offres similaires\nToulouse\nCDI\n35 000€ - 45 000€ par an", capturedAt: "2026-10-25T14:00:00Z" };
const locate = (page = html, externalId?: string) => new MichaelPageSelectedVacancyContextLocator().locate({ providerKey: "MICHAEL_PAGE", sourceUrl: url, html: page, ...(externalId ? { externalId } : {}) });
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

describe("Michael Page bounded vacancy", () => {
  it("extracts literal facts and the complete body without related offers", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("jn-082026-7089819");
    expect(observation.publishedAt?.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    const context = acquisition.contexts![0]!;
    expect(michaelPageFacts(context.html!)?.description).toBe(michaelPageFacts(html)?.description);
    expect(context.text).toContain("Assurer le suivi technique des projets");
    expect(context.text).toContain("Possibilité de télétravail 1 jour / semaine une fois formé(e) et autonome.");
    expect(context.text).toContain("Télétravail possible");
    expect(context.text).not.toMatch(/Offres similaires|Toulouse|Mulhouse|Massy|35 000|45 000|55 000|\bCDI\b/);
    expect(context.html).not.toMatch(/similar-jobs|<nav\b|<aside\b|application\/ld\+json/);
    expect(context.metadata).toMatchObject({ publicationText: "Ajoutée le 25/08/2026", teleworkText: "Télétravail possible", intermediaryName: "Michael Page" });
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual([title]);
    expect(evidence.locations.map(l => l.value)).toEqual(["Neuilly-sur-Seine"]);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INTERIM"]);
    expect(evidence.compensations).toEqual([]); expect(evidence.workModes).toEqual([]);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Michael Page", role: "RECRUITMENT_AGENCY" }));
    expect(evidence.organizations.filter(o => o.role === "EMPLOYER" || o.role === "CLIENT")).toEqual([]);
  });
  it("ignores poisoned related salaries/contracts/locations", () => {
    const related = elements(html, "similar-jobs-wrapper")[0]!;
    expect(related).toBeDefined();
    const poisoned = related.replaceAll("Interim", "CDI").replaceAll("Toulouse", "Berlin").replaceAll("45 000", "999 999");
    expect(locate(html.replace(related, poisoned))?.text).toBe(locate()?.text);
  });
  it("does not treat corrected JSON-LD publisher/TELECOMMUTE/empty salary fields as vacancy facts", async () => {
    const structured = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", url, hiringOrganization: { name: "Michael Page France" }, jobLocationType: "TELECOMMUTE", employmentType: "TEMPORARY", baseSalary: { currency: "", value: { minValue: "", maxValue: "" } } })}</script>`;
    const evidence = await createVacancyEvidenceExtractor().extract(capture(html + structured).observation);
    expect(evidence.workModes).toEqual([]); expect(evidence.compensations).toEqual([]);
    expect(evidence.organizations.some(o => o.role === "EMPLOYER")).toBe(false);
  });
  it.each([
    ["JN-082026-7089819", "JN-082026-9999999"],
    ["jn-082026-7089819", "jn-082026-9999999"],
    ['class="job-location">', 'class="job-location">Wrong '],
  ])("rejects conflicting selected identity or header/summary facts: %s", async (before, after) => {
    const page = html.replace(article, article.replace(before, after));
    // The location class lives in the header, so change it there for this case.
    const changed = before.includes("job-location") ? html.replace(before, after) : page;
    expect(locate(changed)).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract({ ...capture(changed).observation, title: "Stale", locationText: "Toulouse", displayedCompanyName: "Michael Page France", salaryText: "45000 EUR / YEAR" });
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.compensations).toEqual([]);
  });
  it("rejects conflicting Apply, canonical, supplied and structured identities", () => {
    expect(locate(html.replace(/(job-apply\/[^"?]+)jn-082026-7089819/u, "$1jn-082026-9999999"))).toBeUndefined();
    expect(locate(html.replace('jn-082026-7089819">', 'jn-082026-9999999">'))).toBeUndefined();
    expect(locate(html, "jn-082026-9999999")).toBeUndefined();
    expect(locate(html + `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", url, identifier: "jn-082026-9999999" })}</script>`)).toBeUndefined();
  });
  it.each(["missing", "duplicate", "incomplete", "hidden"])("fails closed for %s selected article", variant => {
    const page = variant === "missing" ? html.replace(article, "") : variant === "duplicate" ? html + article
      : variant === "incomplete" ? html.replace('class="job_advert__job-desc-candidate"', 'class="missing"')
      : html.replace(article, article.replace('<article ', '<article hidden '));
    expect(locate(page)).toBeUndefined();
  });
  it("requires vacancy-level client context for the intermediary role", () => {
    const page = html.replaceAll("Mon client est", "Cette société est");
    expect(locate(page)?.metadata?.intermediaryName).toBeUndefined();
  });
  it("scopes the route grammar to this provider", () => {
    expect(michaelPageVacancyId(url + "?tracking=1")).toBe("jn-082026-7089819");
    expect(michaelPageVacancyId(url.replace("michaelpage.fr", "other.fr"))).toBeUndefined();
    expect(michaelPageVacancyId(url.replace("job-detail", "jobs"))).toBeUndefined();
  });
  it("retains unresolved employer and human decisions through identical and changed recapture", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Capture failed");
      expect(first.processing.employerStatus).toBe("UNRESOLVED_RECORD_CREATED");
      const canonicalId = first.processing.canonicalVacancyId;
      db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
        VALUES ('interest',?,'INTERESTED','2026-10-25T14:00:00Z','2026-10-25T14:00:00Z',NULL)`).run(canonicalId);
      db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at)
        VALUES ('role',?,'name:michael page','Michael Page','michael page','STAFFING_AGENCY',NULL,'{}',1,'2026-10-25T14:00:00Z')`).run(canonicalId);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T14:01:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replaceAll("Vos principales missions", "Vos missions principales"), capturedAt: "2026-10-25T14:02:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
    } finally { db.close(); }
  });
});

it.skipIf(!process.env.MICHAEL_PAGE_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual Michael Page capture on an in-memory copy", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close(); migrateDatabase(db);
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById("49e72d11-361b-4682-82d1-bf3100cb67ee"))!;
    const canonicalId = "d9286dca-4ead-4478-a136-e4132aa8d68d";
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history();
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T15:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const repaired = (await observations.findById(first.capture.observationId))!;
    expect(repaired.source.externalId).toBe("jn-082026-7089819");
    expect(repaired.publishedAt?.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(canonical.role.value?.title).toBe(title); expect(canonical.location.value?.rawText).toBe("Neuilly-sur-Seine");
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INTERIM"]);
    expect(canonical.compensation.status).toBe("UNKNOWN"); expect(canonical.workMode.status).toBe("UNKNOWN");
    const evidence = await createVacancyEvidenceExtractor().extract(repaired);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "Michael Page", role: "RECRUITMENT_AGENCY" }));
    expect(evidence.organizations.filter(o => ["CLIENT", "EMPLOYER"].includes(o.role))).toEqual([]);
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T15:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(history()).toEqual(after); expect(await observations.findById(original.id)).toEqual(original);
  } finally { db.close(); }
});
