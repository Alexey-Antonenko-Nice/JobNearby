import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { RenaultSelectedVacancyContextLocator, renaultFacts } from "../../src/application/acquisition/RenaultWorkdayVacancy.js";
import { kellyElements as elements } from "../../src/application/acquisition/KellyWorkdayVacancy.js";
import { randstadText } from "../../src/application/acquisition/RandstadVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";

const html = readFileSync("tests/fixtures/renaultWorkdaySpanishSelectedVacancy.html", "utf8");
const url = "https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/job/Valladolid/Becario_JOBREQ_50271594/";
const payload = { pageUrl: url, pageTitle: "Becario", html, visibleText: "Becario page is loaded\nNavigation\nOther jobs", capturedAt: "2026-10-25T08:00:00Z" };
const locate = (page = html) => new RenaultSelectedVacancyContextLocator().locate({ providerKey: "RENAULT_WORKDAY", sourceUrl: url, html: page });
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

describe("Renault Spanish description within the French interface", () => {
  it("reproduces the old boundary failure: four locations in the page, one in the selected details", () => {
    const page = elements(html, "jobPostingPage")[0]!;
    expect(elements(page, "locations")).toHaveLength(4);
    expect(elements(page, "similarJobsCard")).toHaveLength(3);
    expect(renaultFacts(page)).toBeUndefined(); // old locator passed this entire page to the duplicate-field guard
    expect(elements(elements(page, "job-posting-details")[0]!, "locations")).toHaveLength(1);
    expect(locate()).toBeDefined();
  });
  it("preserves the complete Spanish description, accented legal employer and separate date evidence", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("JOBREQ_50271594");
    const context = acquisition.contexts![0]!;
    expect(renaultFacts(context.html!)?.description).toBe(randstadText(elements(html, "jobPostingDescription")[0]!));
    expect(context.text).toContain("Conocimientos básicos de redes TCP/IP, sistemas operativos, arquitectura de ordenadores y herramientas ofimáticas.");
    expect(context.text).not.toMatch(/page is loaded|50278895|50280911|50276054|Emplois similaires|réinvente la mobilité|futuREady|Connexion/);
    expect(context.html).not.toMatch(/similarJobsCard|50278895|50280911|50276054/);
    expect(context.metadata).toMatchObject({ branding: "Renault Group", displayedLocation: "Valladolid",
      structuredLocation: { address: { addressCountry: "Espagne", addressLocality: "ES_REN_ESPANA VALLADOLID D.C." } },
      publicationRelativeText: "Offre publiée il y a 2 jours", datePosted: "2026-10-22", validThrough: "2026-11-09",
      applicationDeadlineText: "Date de fin : 9 novembre 2026 (Il reste 14 jour(s) pour postuler)" });
    expect(observation.publishedAt?.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Becario"]);
    expect(evidence.locations.map(l => l.value)).toEqual(["Valladolid"]);
    expect(evidence.organizations.map(o => [o.value, o.role])).toEqual([["RENAULT ESPAÑA, S.A.", "DISPLAYED_COMPANY"], ["RENAULT ESPAÑA, S.A.", "EMPLOYER"]]);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["FULL_TIME", "INTERNSHIP"]);
    expect(evidence.engagements[1]!.rawTerms).toContain("La beca permitiría al estudiante adquirir conocimientos prácticos en áreas como:");
    expect(evidence.languageRequirements).toEqual([]);
    expect(evidence.compensations).toEqual([]); expect(evidence.workModes).toEqual([]);
  });
  it("does not depend on Spanish description wording to accept the selected context", async () => {
    const description = elements(html, "jobPostingDescription")[0]!;
    const translated = html.replace(description, '<div data-automation-id="jobPostingDescription"><p>Société</p>RENAULT ESPAÑA, S.A.<p></p><p>Descriptif du poste</p><p>Alternative vacancy description.</p></div>');
    expect(locate(translated)).toBeDefined();
    const evidence = await createVacancyEvidenceExtractor().extract(capture(translated).observation);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["FULL_TIME"]);
    expect(evidence.languageRequirements).toEqual([]);
  });
  it.each([
    [">JOBREQ_50271594</dd>", ">JOBREQ_99999999</dd>"],
    ['"value" : "JOBREQ_50271594"', '"value" : "JOBREQ_99999999"'],
    ['JOBREQ_50271594//apply', 'JOBREQ_99999999//apply'],
    ['JOBREQ_50271594">', 'JOBREQ_99999999">'],
  ])("still rejects selected identity disagreement: %s", (before, after) => {
    expect(html).toContain(before); expect(locate(html.replace(before, after))).toBeUndefined();
  });
  it("does not hide unmarked neighbors, duplicate selected facts or conflicting selected links", () => {
    expect(locate(html.replaceAll('data-automation-id="similarJobsCard"', 'data-automation-id="unknownCard"'))).toBeUndefined();
    const details = elements(html, "job-posting-details")[0]!;
    const location = elements(details, "locations")[0]!;
    expect(locate(html.replace(location, location + location))).toBeUndefined();
    expect(locate(html.replace(location, location + '<a href="/fr-FR/renault-group-careers/job/Other_JOBREQ_111">Other</a>'))).toBeUndefined();
    expect(locate(html.replace('data-automation-id="similar-jobs-heading"', 'data-automation-id="unknownHeading"'))).toBeUndefined();
  });
  it("refuses related-card markers inside selected details and cards containing selected identity fields", () => {
    const card = elements(html, "similarJobsCard")[0]!;
    const description = elements(html, "jobPostingDescription")[0]!;
    expect(locate(html.replace(description, description + card))).toBeUndefined();
    expect(locate(html.replace(card, card.replace('</h4>', '</h4><div data-automation-id="requisitionId">JOBREQ_111</div>')))).toBeUndefined();
  });
  it("keeps legal employers separate and preserves decisions through recapture", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const frenchHtml = readFileSync("tests/fixtures/renaultWorkdaySelectedVacancy.html", "utf8");
      const frenchUrl = /<link rel="canonical" href="([^"]+)"/u.exec(frenchHtml)![1]!;
      const french = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: frenchHtml, pageUrl: frenchUrl });
      const spanish = await runtime.captureAndProcessBrowserVacancy(payload);
      if (french.processing.status !== "PROCESSED" || spanish.processing.status !== "PROCESSED") throw Error("Capture failed");
      const clusters = db.prepare("SELECT display_label FROM employer_clusters ORDER BY display_label").all();
      expect(clusters).toEqual([{ display_label: "RENAULT ESPAÑA, S.A." }, { display_label: "RENAULT s.a.s." }]);
      const id = spanish.processing.canonicalVacancyId;
      db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
        VALUES ('interest',?,'INTERESTED','2026-10-25T08:00:00Z','2026-10-25T08:00:00Z',NULL)`).run(id);
      db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at)
        VALUES ('role',?,'name:renault españa, s.a.','RENAULT ESPAÑA, S.A.','renault españa, s.a.','CLIENT',NULL,'{}',1,'2026-10-25T08:00:00Z')`).run(id);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T08:01:00Z" });
      expect(repeated.capture.observationId).toBe(spanish.capture.observationId);
      expect(repeated.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: id, observationAdded: false });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
    } finally { db.close(); }
  });
});

it.skipIf(!process.env.RENAULT_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual Spanish stored observation only in memory", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById("ad559655-81c5-4b19-a2d7-fce07017bd1e"))!;
    const canonicalId = "0bbfb2dc-e930-4233-97df-9dabd5dc9cb1";
    expect(original.source.externalId).toBe("JOBREQ_50271594");
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history();
    const evidence = await createVacancyEvidenceExtractor().extract(original);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Becario"]);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "RENAULT ESPAÑA, S.A.", role: "EMPLOYER" }));
    expect(evidence.languageRequirements).toEqual([]);
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T09:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(canonical.role.value?.title).toBe("Becario"); expect(canonical.location.value?.rawText).toBe("Valladolid");
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME", "INTERNSHIP"]);
    expect(canonical.languageRequirements.status).toBe("UNKNOWN");
    expect(canonical.workMode.status).toBe("UNKNOWN"); expect(canonical.compensation.status).toBe("UNKNOWN");
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T09:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
    expect(history()).toEqual(after); expect(await observations.findById(original.id)).toEqual(original);
  } finally { db.close(); }
});
