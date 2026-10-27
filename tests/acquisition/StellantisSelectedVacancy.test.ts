import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { resolveLegacyStellantisContinuity } from "../../src/application/vacancies/resolveLegacyStellantisContinuity.js";
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { StellantisSelectedVacancyContextLocator, stellantisFacts, stellantisVacancyId } from "../../src/application/acquisition/StellantisVacancy.js";
import { adeccoElementsWithClass as elements } from "../../src/application/acquisition/AdeccoSelectedVacancyContextLocator.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
const html = readFileSync("tests/fixtures/stellantisSelectedVacancy.html", "utf8");
const url = "https://jobs.groupe-psa.com/offre-de-emploi/emploi-responsable-technique-sous-systeme-propulsion-_17004.aspx";
const title = "Responsable Technique Sous-Système Propulsion";
const payload = { pageUrl: url, pageTitle: `STELLANTIS - ${title}`, html, visibleText: "Accueil\nMa recherche\nStage\nGONESSE", capturedAt: "2026-10-27T23:00:00Z" };
function capture(page = html) {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, html: page }, "a");
  return { acquisition, observation: new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, "o") };
}
const locate = (page = html) => new StellantisSelectedVacancyContextLocator().locate({ providerKey: "STELLANTIS", sourceUrl: url, html: page });
async function extract(page = html) { return createVacancyEvidenceExtractor().extract(capture(page).observation); }
describe("Stellantis selected saved vacancy", () => {
  it("validates route/reference and extracts bounded title, explicit city, CDI and Cadre", async () => {
    const { acquisition, observation } = capture();
    expect(acquisition.externalId).toBe("17004");
    expect(acquisition.contexts?.[0]?.metadata).toMatchObject({ displayedReference: "2025-17004", professionalStatus: "Cadre", locationEvidence: "VISIBLE_VILLE_FIELD" });
    expect(observation.title).toBe(title); expect(observation.locationText).toBe("Poissy");
    const e = await extract();
    expect(e.vacancyTitles.map(t => t.value)).toEqual([title]);
    expect(e.locations.map(l => l.value)).toEqual(["Poissy"]);
    expect(e.engagements.flatMap(e => e.normalizedTerms)).toEqual(["INDEFINITE", "CADRE"]);
    expect(e.organizations).toContainEqual(expect.objectContaining({ value: "Stellantis", role: "DISPLAYED_COMPANY" }));
    expect(e.organizations.some(o => o.value === "Accueil Ma" || o.role === "RECRUITER" || o.role === "EMPLOYER")).toBe(false);
    expect(e.compensations).toEqual([]);
  });
  it("preserves the full mission/profile and excludes navigation, related jobs and employer profile", () => {
    const context = locate()!; const facts = stellantisFacts(context.html!)!;
    expect(context.text).toContain(facts.description); expect(context.text).toContain(facts.profile);
    expect(context.text).toContain("Centre Technique West Europe de Poissy");
    expect(context.text).not.toMatch(/Accueil|Ma recherche|Sochaux|GONESSE|Poissy Green Campus|Nous rejoindre, c'est intégrer|Fort de son efficience|Ces offres pourraient/);
  });
  it("does not infer Poissy from narrative or sidebar when the explicit city is absent", async () => {
    const block = elements(html, "ts-block-2")[0]!;
    const page = html.replace(block, block.replace(/<div>\s*Poissy\s*<\/div>/u, ""));
    expect(locate(page)).toBeDefined();
    expect((await extract(page)).locations).toEqual([]);
  });
  it("does not infer company from the separate employer profile", async () => {
    const content = elements(html, "ts-offer-page__content")[0]!;
    expect((await extract(html.replace(content, content.replace("Chez Stellantis, nous", "Dans notre groupe, nous")))).organizations).toEqual([]);
  });
  it("ignores poisoned sidebar marketing and related cards", async () => {
    const profile = elements(html, "ts-offer-page__entity-description")[0]!;
    const related = elements(html, "ts-related-offers")[0]!;
    const page = html.replace(profile, '<div class="ts-offer-page__entity-description">Agence Accueil Ma recrute à Paris, 999999 EUR / YEAR</div>').replace(related, '<div class="ts-related-offers">Other job Lyon Stage 999999 EUR / YEAR</div>');
    expect(locate(page)?.text).toBe(locate()?.text);
    expect((await extract(page)).organizations).toEqual((await extract()).organizations);
  });
  it.each(["reference", "print", "title", "missing", "duplicate", "hidden"])("rejects %s disagreement or ambiguous selection", async variant => {
    const content = elements(html, "ts-offer-page__content")[0]!;
    const page = variant === "reference" ? html.replaceAll("2025-17004", "2025-17005")
      : variant === "print" ? html.replace('imprimer-fiche-emploi-responsable-technique-sous-systeme-propulsion-_17004.aspx', 'imprimer-fiche-emploi-responsable-technique-sous-systeme-propulsion-_17005.aspx')
      : variant === "title" ? html.replace(content, content.replace(title, "Other title"))
      : variant === "missing" ? html.replace(content, "")
      : variant === "duplicate" ? html.replace(content, content + content)
      : html.replace(content, content.replace('<div ', '<div hidden '));
    expect(locate(page)).toBeUndefined();
    const e = await createVacancyEvidenceExtractor().extract({ ...capture(page).observation, title: "Stale", locationText: "Paris", displayedCompanyName: "Accueil Ma" });
    expect(e.vacancyTitles).toEqual([]); expect(e.locations).toEqual([]); expect(e.organizations).toEqual([]);
  });
  it("restricts the route and rejects a conflicting supplied ID", () => {
    expect(stellantisVacancyId(url + '?tracking=1')).toBe("17004");
    expect(stellantisVacancyId(url.replace('jobs.groupe-psa.com', 'other.com'))).toBeUndefined();
    expect(new StellantisSelectedVacancyContextLocator().locate({ providerKey: "STELLANTIS", sourceUrl: url, html, externalId: "17005" })).toBeUndefined();
  });
  it("requires one validated legacy canonical and agreement from every member", async () => {
    const current = capture().observation;
    const { externalId: _id, ...oldSource } = current.source;
    const old = { ...current, id: "old", source: oldSource };
    let ambiguous = false, conflictingMember = false;
    const deps = {
      sourceObservationRepository: {
        findUnidentifiedBySourceUrlFragment: async () => ambiguous ? [old, { ...old, id: "old2" }] : [old],
        findById: async () => conflictingMember ? { ...old, source: { ...oldSource, sourceUrl: url.replace("17004", "17005") } } : old,
      },
      canonicalVacancyRepository: {
        findBySourceObservationId: async (id: string) => id === current.id ? null : { id: id === "old2" ? "second-canonical" : "original-canonical" },
        findByExactSourceIdentity: async () => null,
        findClaimedSourceObservationIds: async () => ["old"],
      },
    } as unknown as Parameters<typeof resolveLegacyStellantisContinuity>[1];
    expect(await resolveLegacyStellantisContinuity(current, deps)).toBe("original-canonical");
    ambiguous = true;
    expect(await resolveLegacyStellantisContinuity(current, deps)).toBeUndefined();
    ambiguous = false; conflictingMember = true;
    expect(await resolveLegacyStellantisContinuity(current, deps)).toBeUndefined();
  });
  it("recaptures identical snapshots in memory", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      const second = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt: "2026-10-27T23:01:00Z" });
      expect(second.capture.observationId).toBe(first.capture.observationId);
      if (first.processing.status !== "PROCESSED") throw Error("Capture failed");
      expect(second.processing).toMatchObject({ canonicalVacancyId: first.processing.canonicalVacancyId, observationAdded: false });
    } finally { db.close(); }
  });
});
it.skipIf(!process.env.STELLANTIS_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("repairs original Stellantis canonical in memory, preserving decisions and old assignments", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close(); migrateDatabase(db);
  try {
    const repo = new SqliteSourceObservationRepository(db);
    const original = (await repo.findById("7d4cfe85-24ed-41a4-a29f-e3a4b7e00aad"))!;
    const canonical = "3e6d50c4-49ef-4116-a213-96da28b5e636";
    const a = original.metadata.acquisition as { html: string; pageTitle: string };
    db.prepare(`INSERT INTO user_vacancy_interaction_events (id,canonical_vacancy_id,event_type,occurred_at,recorded_at,metadata_json) VALUES ('stellantis-test-interest',?,'INTERESTED','2026-10-27T23:00:00Z','2026-10-27T23:00:00Z',NULL)`).run(canonical);
    db.prepare(`INSERT INTO vacancy_organization_role_decisions (id,canonical_vacancy_id,identity_key,organization_name,normalized_name,role,previous_decision_id,basis_json,override_acknowledged,created_at) VALUES ('stellantis-test-role',?,'name:stellantis','Stellantis','stellantis','CLIENT',NULL,'{}',1,'2026-10-27T23:00:00Z')`).run(canonical);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name='observation_cluster_assignments' OR name='confirmed_organization_roles')").all() as { name: string }[];
    const history = () => tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()] as const);
    const before = history(); const runtime = createCaptureProcessingRuntime(db);
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: a.pageTitle, html: a.html, visibleText: original.rawContent!, capturedAt: "2026-10-27T23:01:00Z" };
    const first = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(first.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: canonical });
    const c = (await new SqliteCanonicalVacancyRepository(db).findById(canonical))!;
    expect(c.role.value?.title).toBe(title); expect(c.location.value?.rawText).toBe("Poissy");
    expect(c.engagement.value?.normalizedTerms).toEqual(["INDEFINITE", "CADRE"]);
    expect(c.organizationRelationships.some(o => o.rawName === "Accueil Ma")).toBe(false);
    expect(c.organizationRelationships).toContainEqual(expect.objectContaining({ rawName: "Stellantis", role: "CLIENT" }));
    const after = history();
    for (const [name, rows] of before) expect(after.find(([table]) => table === name)?.[1]).toEqual(expect.arrayContaining(rows));
    const second = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-27T23:02:00Z" });
    expect(second.capture.observationId).toBe(first.capture.observationId);
    expect(second.processing).toMatchObject({ canonicalVacancyId: canonical, observationAdded: false });
    expect(history()).toEqual(after); expect(await repo.findById(original.id)).toEqual(original);
  } finally { db.close(); }
}, 20_000);
