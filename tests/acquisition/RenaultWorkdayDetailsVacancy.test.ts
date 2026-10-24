import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { RenaultSelectedVacancyContextLocator, renaultFacts, renaultVacancyId } from "../../src/application/acquisition/RenaultWorkdayVacancy.js";
import { kellyElements as elements } from "../../src/application/acquisition/KellyWorkdayVacancy.js";
import { randstadText } from "../../src/application/acquisition/RandstadVacancy.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";

const html = readFileSync("tests/fixtures/renaultWorkdayDetailsVacancy.html", "utf8");
const url = "https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/details/Lead-Buyer-ADAS--H-F-_JOBREQ_50282407";
const pane = elements(html, "jobDetails")[0]!;
const description = elements(pane, "jobPostingDescription")[0]!;
const payload = { pageUrl: url, pageTitle: "Rechercher des emplois", html, visibleText: "Filters\nLead Buyer ADAS (H/F)\nPostuler", capturedAt: "2026-10-25T12:00:00Z" };
const locate = (page = html, sourceUrl = url, externalId?: string) => new RenaultSelectedVacancyContextLocator().locate({ providerKey: "RENAULT_WORKDAY", sourceUrl, html: page, ...(externalId ? { externalId } : {}) });
const editPane = (edit: (value: string) => string) => html.replace(pane, edit(pane));
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "acquisition");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "observation") };
}

describe("Renault /details/ selected vacancy", () => {
  it("handles the demonstrated route and boundary without using search or stale document facts", async () => {
    expect(elements(html, "jobPostingPage")).toHaveLength(0);
    expect(elements(html, "jobDetails")).toHaveLength(1);
    expect(elements(pane, "locations")).toHaveLength(3); // selected + related jobs
    expect(renaultFacts(pane)).toBeUndefined(); // the unbounded pane would fail too
    expect(renaultVacancyId(url)).toBe("JOBREQ_50282407");
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("JOBREQ_50282407");
    const context = acquisition.contexts![0]!;
    expect(context.html).toContain('data-automation-id="jobDetails"');
    expect(renaultFacts(context.html!)?.description).toBe(randstadText(description));
    expect(context.text).toContain("Avec plus de 80 spécialités achats");
    expect(context.text).toContain("Politique Groupe de protection des données personnelles");
    expect(context.text).not.toMatch(/Chennai|RNTBCI|50267403|50276354|50277158|STAGE|Filters|EMPLOIS TROUVÉS|page is loaded|Emplois similaires/);
    expect(context.html).not.toMatch(/jobResults|similar-jobs-heading|jobSearch|<nav\b|<input\b/);
    expect(context.metadata).toMatchObject({ displayedLocation: "Guyancourt", requisitionId: "JOBREQ_50282407",
      publicationRelativeText: "Offre publiée hier", applicationDeadlineText: "Date de fin : 31 décembre 2026 (Il reste plus de 30 jours pour postuler)" });
    expect(context.metadata?.datePosted).toBeUndefined(); expect(context.metadata?.validThrough).toBeUndefined();
    expect(context.metadata?.structuredLocation).toBeUndefined(); expect(observation.publishedAt).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract(observation);
    expect(evidence.vacancyTitles.map(v => v.value)).toEqual(["Lead Buyer ADAS (H/F)"]);
    expect(evidence.locations.map(l => l.value)).toEqual(["Guyancourt"]);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "RENAULT s.a.s.", role: "EMPLOYER" }));
    expect(evidence.organizations.some(o => /RNTBCI/.test(o.value))).toBe(false);
    expect(evidence.engagements.flatMap(e => e.normalizedTerms)).toEqual(["FULL_TIME"]);
    expect(evidence.compensations).toEqual([]);
  });
  it("retains all DOM description content despite a small scrolling viewport and abbreviated visible text", () => {
    const page = editPane(value => value.replace('aria-label="Job Posting Description"', 'style="height: 50px; overflow-y: auto" aria-label="Job Posting Description"')
      .replace(description, description.replace(/<\/div>$/u, '<p>Complete description tail below the viewport.</p></div>')));
    const context = capture(page).acquisition.contexts![0]!;
    expect(context.text).toContain("Complete description tail below the viewport.");
    expect(context.text).toContain("Vos missions"); expect(context.text).toContain("Votre profil");
  });
  it("ignores all left-hand result identities and excludes unrelated jobs", () => {
    const results = elements(html, "jobResults")[0]!;
    const poisoned = results.replace(/JOBREQ_\d+(?:-\d+)?/gu, "JOBREQ_99999999").replace(/Guyancourt/gu, "Unrelated City");
    expect(locate(html.replace(results, poisoned))?.text).toBe(locate()?.text);
  });
  it.each([
    [">JOBREQ_50282407</dd>", ">JOBREQ_99999999</dd>"],
    ['JOBREQ_50282407/apply', 'JOBREQ_99999999/apply'],
    ['/job/Lead-Buyer-ADAS--H-F-_JOBREQ_50282407"', '/job/Lead-Buyer-ADAS--H-F-_JOBREQ_99999999"'],
  ])("rejects conflicting selected-pane identity: %s", async (before, after) => {
    expect(pane).toContain(before);
    const page = editPane(value => value.replace(before, after));
    expect(locate(page)).toBeUndefined();
    const evidence = await createVacancyEvidenceExtractor().extract({ ...capture(page).observation, title: "Stale", displayedCompanyName: "RNTBCI PL", locationText: "Chennai" });
    expect(evidence.vacancyTitles).toEqual([]); expect(evidence.organizations).toEqual([]); expect(evidence.locations).toEqual([]);
  });
  it("rejects mismatching supplied identity and extra selected detail links", () => {
    expect(locate(html, url, "JOBREQ_99999999")).toBeUndefined();
    expect(locate(editPane(value => value.replace('</h2>', '</h2><a href="/fr-FR/renault-group-careers/details/Other_JOBREQ_99999999">Other</a>')))).toBeUndefined();
  });
  it.each(["missing", "duplicate", "hidden", "display-none", "no-description", "wrong-boundary"])("fails closed for %s selection", async variant => {
    const page = variant === "missing" ? html.replace(pane, "") : variant === "duplicate" ? html + pane
      : variant === "hidden" ? editPane(value => value.replace('<section ', '<section aria-hidden="true" '))
      : variant === "display-none" ? editPane(value => value.replace('<section ', '<section style="display:none" '))
      : variant === "no-description" ? html.replace(description, "")
      : editPane(value => value.replace('data-automation-id="jobDetails"', 'data-automation-id="jobPostingPage"'));
    expect(locate(page)).toBeUndefined();
    expect((await createVacancyEvidenceExtractor().extract(capture(page).observation)).vacancyTitles).toEqual([]);
  });
  it("requires a structurally identified related section and does not hide selected conflicts", () => {
    expect(locate(editPane(value => value.replace('aria-label="Similar jobs"', 'aria-label="Unknown"')))).toBeUndefined();
    const location = elements(pane, "locations")[0]!;
    expect(locate(editPane(value => value.replace(location, location + location)))).toBeUndefined();
    expect(locate(editPane(value => value.replace('<ul aria-label="Similar jobs"', '<div data-automation-id="requisitionId">JOBREQ_111</div><ul aria-label="Similar jobs"')))).toBeUndefined();
  });
  it("validates structured data only when associated with this selected vacancy", () => {
    const script = (body: object) => `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", ...body })}</script>`;
    expect(locate(html + script({ identifier: "JOBREQ_50282407", url: url.replace("50282407", "99999999") }))).toBeUndefined();
    expect(locate(html + script({ identifier: "JOBREQ_99999999", url }))).toBeUndefined();
    const context = locate(html + script({ identifier: "JOBREQ_50282407", url, datePosted: "2026-10-23" }));
    expect(context?.metadata?.datePosted).toBe("2026-10-23");
  });
  it("preserves human decisions, canonical continuity and identical/changed recapture", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Capture failed");
      const canonicalId = first.processing.canonicalVacancyId;
      db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json)
        VALUES ('interest',?,'INTERESTED','2026-10-25T12:00:00Z','2026-10-25T12:00:00Z',NULL)`).run(canonicalId);
      db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at)
        VALUES ('role',?,'name:renault s.a.s.','RENAULT s.a.s.','renault s.a.s.','CLIENT',NULL,'{}',1,'2026-10-25T12:00:00Z')`).run(canonicalId);
      const decisions = db.prepare("SELECT * FROM vacancy_organization_role_decisions").all();
      const interactions = db.prepare("SELECT * FROM user_vacancy_interaction_events").all();
      const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-25T12:01:00Z" });
      expect(repeated.capture.observationId).toBe(first.capture.observationId);
      expect(repeated.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, html: editPane(value => value.replace("Vos missions", "Vos missions principales")), capturedAt: "2026-10-25T12:02:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: true });
      expect(db.prepare("SELECT * FROM vacancy_organization_role_decisions").all()).toEqual(decisions);
      expect(db.prepare("SELECT * FROM user_vacancy_interaction_events").all()).toEqual(interactions);
    } finally { db.close(); }
  });
});

it.skipIf(!process.env.RENAULT_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("replays actual /details/ observation with original canonical and decisions only in memory", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const original = (await observations.findById("b4443e46-5a99-4ca5-a15e-020a702fac54"))!;
    const canonicalId = "b051d2c7-adfc-4c0a-b5f0-b15d19f30ad1";
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history();
    const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T13:00:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId });
    const repaired = (await observations.findById(first.capture.observationId))!;
    expect(repaired.source).toMatchObject({ sourceUrl: original.source.sourceUrl, externalId: "JOBREQ_50282407" });
    const evidence = await createVacancyEvidenceExtractor().extract(repaired);
    expect(evidence.organizations).toContainEqual(expect.objectContaining({ value: "RENAULT s.a.s.", role: "EMPLOYER" }));
    const canonical = (await new SqliteCanonicalVacancyRepository(db).findById(canonicalId))!;
    expect(canonical.role.value?.title).toBe("Lead Buyer ADAS (H/F)"); expect(canonical.location.value?.rawText).toBe("Guyancourt");
    expect(canonical.engagement.value?.normalizedTerms).toEqual(["FULL_TIME"]);
    expect(canonical.compensation.status).toBe("UNKNOWN");
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T13:01:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonicalId, observationAdded: false });
    expect(history()).toEqual(after); expect(await observations.findById(original.id)).toEqual(original);
  } finally { db.close(); }
});
