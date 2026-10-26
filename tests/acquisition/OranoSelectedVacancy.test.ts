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

import { OranoSelectedVacancyContextLocator, oranoVacancyId, oranoFacts } from "../../src/application/acquisition/OranoVacancy.js";
import { adeccoElementsWithClass as elements } from "../../src/application/acquisition/AdeccoSelectedVacancyContextLocator.js";
const html = readFileSync("tests/fixtures/oranoSelectedVacancy.html", "utf8");
const url = "https://jobs.orano.group/en_US/jobs/JobDetail/Stage-Ing-nieur-travaux-en-pr-paration-de-chantier-F-H/16958?source=External%2BCareers%2BMarketplace";
const title = "Ingénieur préparation chantier F/H";
const payload = { pageUrl: url, pageTitle: "Stage Ingénieur travaux en préparation de chantier F/H", html, visibleText: "Unrelated job CDI Paris 999999 EUR / YEAR", capturedAt: "2026-10-25T16:00:00Z" };
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}
async function evidence(page = html) { return createVacancyEvidenceExtractor().extract(capture(page).observation); }
const locate = (page = html) => new OranoSelectedVacancyContextLocator().locate({ providerKey: "ORANO", sourceUrl: url, html: page });
describe("Orano saved vacancy", () => {
  it("chooses agreeing visible titles and retains source disagreement for audit", async () => {
    const { acquisition, observation } = capture();
    expect(observation.source.externalId).toBe("16958");
    expect(observation.title).toBe(title);
    expect(observation.publishedAt?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(acquisition.contexts?.[0]?.metadata).toMatchObject({ durationMonths: 3, durationText: "3", desiredStartingDateText: "01-06-2027", remoteWorkText: "Hybrid", businessUnit: "ADF", alternativeStructuredTitles: [payload.pageTitle] });
    const result = await evidence();
    expect(result.vacancyTitles.map(t => t.value)).toEqual([title]);
    expect(result.locations.map(l => l.value)).toEqual(["Cherbourg-en-Cotentin, Manche, France"]);
    expect(result.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INTERNSHIP"]);
    expect(result.workModes.map(w => w.value)).toEqual(["HYBRID"]);
    expect(result.compensations).toEqual([]);
    expect(result.organizations).toContainEqual(expect.objectContaining({ value: "Orano Aval du futur", role: "DISPLAYED_COMPANY" }));
    expect(result.organizations.some(o => o.value === "ADF" || o.role === "EMPLOYER")).toBe(false);
  });
  it("keeps full description, requirements and qualified benefits, excluding group marketing and navigation", () => {
    const context = locate()!;
    const facts = oranoFacts(html)!;
    expect(context.html).toContain(facts.description);
    expect(context.html).toContain(facts.benefits);
    expect(context.text).toContain("tout au long de ta mission");
    expect(context.text).toContain("1 jour de télétravail par semaine");
    expect(context.text).not.toMatch(/Share this job|Working on current|18,000|Open Positions|999999/);
  });
  it("preserves qualified French telework and schedule without guessing full time or remote", async () => {
    const page = html.replaceAll("Internship", "Stage").replaceAll("Standard Schedule", "Horaire Normal").replaceAll("Hybrid", "Télétravail possible");
    const result = await evidence(page);
    expect(result.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INTERNSHIP"]);
    expect(result.workModes).toEqual([]);
    expect(locate(page)?.text).toContain("Télétravail possible");
  });
  it("does not use the BU or logo as employer when narrative identity is missing", async () => {
    const result = await evidence(html.replaceAll("Chez Orano Aval du futur, nous", "Dans notre équipe, nous"));
    expect(result.organizations.some(o => o.value === "ADF" || o.value === "Orano Aval du futur" || o.role === "EMPLOYER")).toBe(false);
  });
  it.each(["reference", "title", "apply", "missing", "duplicate", "structured"])("rejects %s mismatch or ambiguous boundary", async variant => {
    const facts = oranoFacts(html)!;
    const page = variant === "reference" ? html.replace(facts.general, facts.general.replace("16958", "16959"))
      : variant === "title" ? html.replace(facts.header, facts.header.replace(title, "Other title"))
      : variant === "apply" ? html.replace("ApplicationMethods?jobId=16958", "ApplicationMethods?jobId=16959")
      : variant === "missing" ? html.replace(facts.description, "")
      : variant === "duplicate" ? html + facts.general
      : html + '<script type="application/ld+json">{"@type":"JobPosting","identifier":"16959"}</script>';
    expect(locate(page)).toBeUndefined();
    const result = await createVacancyEvidenceExtractor().extract({ ...capture(page).observation, title: "Stale title", displayedCompanyName: "ADF", contractText: "FULL_TIME" });
    expect(result.vacancyTitles).toEqual([]); expect(result.organizations).toEqual([]); expect(result.engagements).toEqual([]);
  });
  it("ignores related cards and restricts route identity to the validated host/path", () => {
    const related = elements(html, "article--view-more--aside")[0]!;
    const page = html.replace(related, related.replace('</article>', '<a href="/en_US/jobs/JobDetail/Other/99999">Paris CDI 999999 EUR / YEAR</a></article>'));
    expect(locate(page)?.text).toBe(locate()?.text);
    expect(oranoVacancyId(url.replace("jobs.orano.group", "other.group"))).toBeUndefined();
    expect(oranoVacancyId(url + "&jobId=16959")).toBeUndefined();
  });
  it("rejects supplied identity disagreement and hidden or missing selected regions", () => {
    expect(new OranoSelectedVacancyContextLocator().locate({ providerKey: "ORANO", sourceUrl: url, html, externalId: "16959" })).toBeUndefined();
    const facts = oranoFacts(html)!;
    expect(locate(html.replace(facts.general, facts.general.replace('<div ', '<div hidden ')))).toBeUndefined();
    expect(locate(html.replace(facts.benefits, ""))).toBeUndefined();
    expect(locate(html.replace('class="article article--actions"', 'class="missing-actions"'))).toBeUndefined();
  });
  it("does not recover a title from JSON-LD when the visible titles disagree", async () => {
    const facts = oranoFacts(html)!;
    const page = html.replace(facts.general, facts.general.replace(title, payload.pageTitle));
    expect(locate(page)).toBeUndefined();
    expect((await evidence(page)).vacancyTitles).toEqual([]);
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
        VALUES ('role',?,'name:orano aval du futur','Orano Aval du futur','orano aval du futur','STAFFING_AGENCY',NULL,'{}',1,'2026-10-25T16:00:00Z')`).run(canonicalId);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T16:01:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replaceAll("entre terre et mer", "entre terre et mer normande"), capturedAt: "2026-10-25T16:02:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
    } finally { db.close(); }
  });
});

it.skipIf(!process.env.ORANO_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual Orano observation in memory with original canonical and decisions", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById("acd22422-5ca6-42de-a5d5-bbda53c96771"))!;
    const canonicalId = "7b4c34e8-24e0-4a15-b1f6-2b6f4b345e55";
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history();
    // Extraction repairs the immutable original too, not just a freshly mapped observation.
    expect((await createVacancyEvidenceExtractor().extract(original)).vacancyTitles.map(t => t.value)).toEqual([title]);
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T17:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(canonical.role).toMatchObject({ status: "RESOLVED", value: { title } });
    expect(canonical.location.value?.rawText).toBe("Cherbourg-en-Cotentin, Manche, France");
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["INTERNSHIP"]);
    expect(canonical.workMode.value).toBe("HYBRID");
    expect(canonical.compensation.status).toBe("UNKNOWN");
    const repaired = (await observations.findById(first.capture.observationId))!;
    expect(repaired.publishedAt?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect((repaired.metadata.acquisition as { contexts: { metadata: unknown }[] }).contexts[0]?.metadata).toMatchObject({
      durationMonths: 3, desiredStartingDateText: "01-06-2027", businessUnit: "ADF", remoteWorkText: "Hybrid",
    });
    const result = await createVacancyEvidenceExtractor().extract(repaired);
    expect(result.organizations).toContainEqual(expect.objectContaining({ value: "Orano Aval du futur", role: "DISPLAYED_COMPANY" }));
    expect(result.organizations.some(o => ["STAFFING_AGENCY", "EMPLOYER", "CLIENT"].includes(o.role))).toBe(false);
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T17:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ canonicalVacancyId: canonicalId, observationAdded: false });
    expect(history()).toEqual(after);
    expect(await observations.findById(original.id)).toEqual(original);
  } finally { db.close(); }
}, 20_000);
