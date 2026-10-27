import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { RenaultSelectedVacancyContextLocator, renaultFacts, renaultVacancyId, renaultRouteIdentity } from "../../src/application/acquisition/RenaultWorkdayVacancy.js";
import { kellyElements as elements } from "../../src/application/acquisition/KellyWorkdayVacancy.js";
import { randstadText } from "../../src/application/acquisition/RandstadVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";

const html = readFileSync("tests/fixtures/renaultWorkdaySuffixedVacancy.html", "utf8");
const url = "https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/job/Chennai/CA-Braking---Corner-Module--SrEng_JOBREQ_50267403-1/";
const title = "CA_Braking & Corner Module _Sr.Eng";
const payload = { pageUrl: url, pageTitle: title, html, visibleText: "Navigation Other jobs page is loaded", capturedAt: "2026-10-25T10:00:00Z" };
const locate = (page = html, sourceUrl = url, externalId?: string) => new RenaultSelectedVacancyContextLocator().locate({ providerKey: "RENAULT_WORKDAY", sourceUrl, html: page, ...(externalId ? { externalId } : {}) });
function capture(page = html, pageUrl = url) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page, pageUrl }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

describe("Renault corroborated route discriminator", () => {
  it("requires page evidence to promote the suffixed route and keeps both identities", () => {
    // The old digits-only URL extractor rejected this route before DOM validation.
    // It still deliberately cannot promote suffixed identity from a URL alone.
    expect(renaultVacancyId(url)).toBeUndefined();
    expect(renaultRouteIdentity(url)).toEqual({ routeId: "JOBREQ_50267403-1", requisitionId: "JOBREQ_50267403", suffix: "1" });
    expect(locate("")).toBeUndefined();
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("JOBREQ_50267403-1");
    expect(observation.source).toMatchObject({ sourceUrl: url, externalId: "JOBREQ_50267403-1" });
    expect(acquisition.contexts![0]!.metadata).toMatchObject({ routeId: "JOBREQ_50267403-1", requisitionId: "JOBREQ_50267403", routeSuffix: "1" });
    expect(locate(html, url, "JOBREQ_50267403")).toBeUndefined();
    expect(locate(html, url, "JOBREQ_50267403-2")).toBeUndefined();
  });
  it("captures the complete English description and only explicit facts", async () => {
    const { acquisition, observation } = capture();
    const context = acquisition.contexts![0]!;
    expect(renaultFacts(context.html!)?.description).toBe(randstadText(elements(html, "jobPostingDescription")[0]!));
    expect(context.text).toContain("Sustain & develop a good level of cross functional and cultural relationship with all customers.");
    expect(context.text).not.toMatch(/page is loaded|réinvente la mobilité|futuREady|Connexion/);
    expect(context.metadata).toMatchObject({ displayedLocation: "Chennai", branding: "Renault Group",
      structuredLocation: { address: { addressCountry: "Inde", addressLocality: "IN_REN_RNTBCI CHENNAI" } },
      publicationRelativeText: "Offre publiée il y a 3 jours", datePosted: "2026-10-21", validThrough: "2026-11-30",
      applicationDeadlineText: "Date de fin : 30 novembre 2026 (Il reste plus de 30 jours pour postuler)" });
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual([title]);
    expect(evidence.locations.map(l => l.value)).toEqual(["Chennai"]);
    expect(evidence.organizations.map(o => [o.value, o.role])).toEqual([["RNTBCI PL", "DISPLAYED_COMPANY"], ["RNTBCI PL", "EMPLOYER"]]);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["FULL_TIME"]);
    expect(evidence.languageRequirements).toEqual([]); expect(evidence.compensations).toEqual([]); expect(evidence.workModes).toEqual([]);
  });
  it.each([
    [">JOBREQ_50267403</dd>", ">JOBREQ_99999999</dd>"],
    [">JOBREQ_50267403</dd>", ">JOBREQ_50267403-1</dd>"],
    ['"value" : "JOBREQ_50267403"', '"value" : "JOBREQ_99999999"'],
    ['"value" : "JOBREQ_50267403"', '"value" : "JOBREQ_50267403-1"'],
    ['JOBREQ_50267403-1//apply', 'JOBREQ_50267403-2//apply'],
    ['JOBREQ_50267403-1//apply', 'JOBREQ_50267403//apply'],
    ['JOBREQ_50267403-1">', 'JOBREQ_50267403-2">'],
    ['JOBREQ_50267403-1">', 'JOBREQ_50267403">'],
    ['JOBREQ_50267403-1/">', 'JOBREQ_50267403-2/">'],
  ])("rejects actual identity conflict: %s -> %s", async (before, after) => {
    expect(html).toContain(before);
    const page = html.replace(before, after);
    expect(locate(page)).toBeUndefined();
    const { acquisition, observation } = capture(page);
    expect(acquisition.externalId).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract({ ...observation, title: "Stale title", displayedCompanyName: "Renault Group", locationText: "Paris" });
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.locations).toEqual([]); expect(evidence.organizations).toEqual([]);
  });
  it("requires both canonical and structured requisition corroboration for a suffix", () => {
    expect(locate(html.replace(/<link rel="canonical"[^>]*>/u, ""))).toBeUndefined();
    expect(locate(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/u, ""))).toBeUndefined();
    expect(locate(html.replace('"value" : "JOBREQ_50267403"', '"absent" : "JOBREQ_50267403"'))).toBeUndefined();
    expect(locate(html.replace('"@type" : "JobPosting"', '"url": "' + url.replace("-1/", "-2/") + '", "@type" : "JobPosting"'))).toBeUndefined();
    expect(locate(html.replace('</h2>', '</h2><a href="' + url.replace("-1/", "-2/") + '">Other route</a>'))).toBeUndefined();
  });
  it.each(["-0", "-01", "-1-2", "-abc"])("does not blindly strip %s", suffix => {
    const source = url.replace("-1/", suffix + "/");
    expect(renaultRouteIdentity(source)).toBeUndefined(); expect(locate(html, source)).toBeUndefined();
  });
  it.each([url.replace("alliancewd", "other"), url.replace("renault-group-careers", "other-site"), url.replace("fr-FR", "en-US")])("does not widen other tenants or locales: %s", source => {
    expect(renaultRouteIdentity(source)).toBeUndefined(); expect(locate(html, source)).toBeUndefined();
  });
  it("keeps different routes of the same requisition separate, and distinct legal employers separate", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      const other = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: url.replace("-1/", "-2/"), html: html.replaceAll("JOBREQ_50267403-1", "JOBREQ_50267403-2") });
      const plain = await runtime.captureAndProcessBrowserVacancy({ ...payload, pageUrl: url.replace("-1/", "/"), html: html.replaceAll("JOBREQ_50267403-1", "JOBREQ_50267403") });
      if (first.processing.status !== "PROCESSED" || other.processing.status !== "PROCESSED" || plain.processing.status !== "PROCESSED") throw Error("Capture failed");
      expect(new Set([first.processing.canonicalVacancyId, other.processing.canonicalVacancyId, plain.processing.canonicalVacancyId]).size).toBe(3);
      const canonicalId = first.processing.canonicalVacancyId;
      db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
        VALUES ('interest',?,'INTERESTED','2026-10-25T10:00:00Z','2026-10-25T10:00:00Z',NULL)`).run(canonicalId);
      db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at)
        VALUES ('role',?,'name:rntbci pl','RNTBCI PL','rntbci pl','CLIENT',NULL,'{}',1,'2026-10-25T10:00:00Z')`).run(canonicalId);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T10:01:00Z" });
      expect(repeated.capture.observationId).toBe(first.capture.observationId);
      expect(repeated.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: html.replaceAll("Control the cost and optimize", "Control the costs and optimize"), capturedAt: "2026-10-25T10:02:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
      for (const fixture of ["renaultWorkdaySelectedVacancy.html", "renaultWorkdaySpanishSelectedVacancy.html"]) {
        const page = readFileSync(`tests/fixtures/${fixture}`, "utf8");
        const pageUrl = /<link rel="canonical" href="([^"]+)"/u.exec(page)![1]!;
        expect((await runtime.captureAndProcessBrowserVacancy({ ...payload, html: page, pageUrl })).processing.status).toBe("PROCESSED");
      }
      expect(db.prepare("SELECT display_label FROM employer_clusters ORDER BY display_label").all()).toEqual([
        { display_label: "RENAULT ESPAÑA, S.A." }, { display_label: "RENAULT s.a.s." }, { display_label: "RNTBCI PL" }]);
    } finally { db.close(); }
  });
});

it.skipIf(!process.env.RENAULT_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual suffixed stored observation with original canonical and decisions in memory", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close(); migrateDatabase(db);
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById("2d838002-46ff-47ea-9342-6b988b40faad"))!;
    const canonicalId = "6746aeed-02b5-4dac-911e-f5a5c11e5916";
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history();
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T11:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const repairedObservation = (await observations.findById(first.capture.observationId))!;
    expect(repairedObservation.source).toMatchObject({ sourceUrl: original.source.sourceUrl, externalId: "JOBREQ_50267403-1" });
    const evidence = await createVacancyEvidenceExtractor().extract(repairedObservation);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "RNTBCI PL", role: "EMPLOYER" }));
    expect(evidence.languageRequirements).toEqual([]);
    const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(canonical.role.value?.title).toBe(title); expect(canonical.location.value?.rawText).toBe("Chennai");
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(canonical.languageRequirements.status).toBe("UNKNOWN");
    expect(canonical.workMode.status).toBe("UNKNOWN"); expect(canonical.compensation.status).toBe("UNKNOWN");
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T11:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
    expect(history()).toEqual(after); expect(await observations.findById(original.id)).toEqual(original);
  } finally { db.close(); }
});
