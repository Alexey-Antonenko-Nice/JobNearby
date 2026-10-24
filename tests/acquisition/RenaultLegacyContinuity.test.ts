import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { BrowserCaptureAcquisitionAdapter } from "../../src/application/acquisition/BrowserCaptureAcquisitionAdapter.js";
import { DeterministicAcquisitionCaptureMapper } from "../../src/application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { browserCaptureFingerprint } from "../../src/application/acquisition/browserCaptureFingerprint.js";
import { resolveLegacyRenaultContinuity } from "../../src/application/vacancies/resolveLegacyRenaultContinuity.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { CanonicalVacancyRepository } from "../../src/domain/vacancies/CanonicalVacancyRepository.js";

const html = readFileSync("tests/fixtures/renaultWorkdaySelectedVacancy.html", "utf8");
const url = "https://alliancewd.wd3.myworkdayjobs.com/fr-FR/renault-group-careers/job/Aubevoye/CS27---BAC-5---Stage-ingnieur-digitalisation-mtier-synthse-prestation-vhicules-H-F_JOBREQ_50273077/";
const payload = { pageUrl: url, pageTitle: "Stage", html, visibleText: "Navigation Other Company Remote 90000 EUR / YEAR page is loaded", capturedAt: "2026-10-24T21:24:46.162Z" };

function observation(id: string, observedAt: string, identified: boolean): SourceObservation {
  const acquisition = new BrowserCaptureAcquisitionAdapter().toAcquisitionPackage({ ...payload, capturedAt: observedAt }, `acq-${id}`);
  const mapped = new DeterministicAcquisitionCaptureMapper().toSourceObservation(acquisition, id);
  const { externalId: _externalId, ...source } = mapped.source;
  const result = { ...mapped, ...(identified ? {} : { source }) };
  return { ...result, contentFingerprint: browserCaptureFingerprint(result) };
}

function fakeCanonicals(claims: Record<string, string[]>): CanonicalVacancyRepository {
  const byObservation = new Map(Object.entries(claims).flatMap(([canonical, members]) => members.map(member => [member, canonical] as const)));
  return {
    findBySourceObservationId: async (id: string) => byObservation.has(id) ? { id: byObservation.get(id)! } as never : null,
    findByExactSourceIdentity: async () => null,
    findClaimedSourceObservationIds: async (id: string) => claims[id] ?? [],
  } as unknown as CanonicalVacancyRepository;
}

async function resolve(human: string[] | undefined, order: "oldest-first" | "newest-first" = "oldest-first") {
  const sourceObservationRepository = new InMemorySourceObservationRepository();
  const legacy = [observation("legacy-old", "2026-10-24T21:24:46.162Z", false), observation("legacy-new", "2026-10-24T22:12:15.012Z", false)];
  for (const item of order === "oldest-first" ? legacy : [...legacy].reverse()) await sourceObservationRepository.save(item);
  const current = observation("current", "2026-10-25T08:00:00.000Z", true);
  expect(current.source.externalId).toBe("JOBREQ_50273077");
  return resolveLegacyRenaultContinuity(current, {
    sourceObservationRepository,
    canonicalVacancyRepository: fakeCanonicals({ "canonical-old": ["legacy-old"], "canonical-new": ["legacy-new"] }),
    ...(human === undefined ? {} : { humanStateLookup: async ids => new Set(ids.filter(id => human.includes(id))) }),
  });
}

describe("Renault ambiguous legacy continuity", () => {
  it.each(["oldest-first", "newest-first"] as const)("attaches to the earliest duplicate without a decision (%s)", async order => {
    expect(await resolve([], order)).toBe("canonical-old");
  });
  it("prefers the only duplicate carrying a human decision", async () => {
    expect(await resolve(["canonical-new"])).toBe("canonical-new");
  });
  it("stays ambiguous when several duplicates carry decisions or decisions cannot be checked", async () => {
    expect(await resolve(["canonical-old", "canonical-new"])).toBeUndefined();
    expect(await resolve(undefined)).toBeUndefined();
  });
});

describe("identical unidentified recapture", () => {
  it.each([
    ["in-memory", () => new InMemorySourceObservationRepository()],
    ["sqlite", () => new SqliteSourceObservationRepository(createDatabase(":memory:"))],
  ])("reuses the earliest identical snapshot (%s)", async (_name, create) => {
    const repository = create();
    const first = observation("first", "2026-10-24T21:24:46.162Z", false);
    const second = observation("second", "2026-10-24T22:12:15.012Z", false);
    expect(second.contentFingerprint).toBe(first.contentFingerprint);
    const saved = await repository.saveOrReuseBrowserSnapshot(first, { id: "o1", capturedAt: first.observedAt, capturedUrl: url });
    const reused = await repository.saveOrReuseBrowserSnapshot(second, { id: "o2", capturedAt: second.observedAt, capturedUrl: url });
    expect(reused).toEqual({ sourceObservationId: saved.sourceObservationId, snapshotCreated: false });
    expect(await repository.findById("second")).toBeNull();
    const changed = observation("third", "2026-10-24T23:00:00.000Z", false);
    const different = { ...changed, contentFingerprint: "different" };
    expect((await repository.saveOrReuseBrowserSnapshot(different, { id: "o3", capturedAt: changed.observedAt, capturedUrl: url })).snapshotCreated).toBe(true);
    const otherUrl = { ...second, id: "fourth", source: { ...second.source, sourceUrl: `${url}?other=1` } };
    expect((await repository.saveOrReuseBrowserSnapshot(otherUrl, { id: "o4", capturedAt: second.observedAt, capturedUrl: url })).snapshotCreated).toBe(true);
  });
});

// Opt-in: reads the saved database once; everything runs on a private in-memory copy.
it.skipIf(!process.env.RENAULT_STORED_REPLAY || !existsSync("job-nearby.sqlite"))("recaptures the actual stored duplicate pair into one existing canonical without touching either", async () => {
  const disk = new Database("job-nearby.sqlite", { readonly: true, fileMustExist: true });
  const db = new Database(disk.serialize()); disk.close();
  try {
    const observations = new SqliteSourceObservationRepository(db);
    const [oldId, newId] = ["9bdc9cd9-56f0-444a-9938-1afb39bb5907", "445d0013-361e-4189-a477-a32ddaa683e9"];
    const [oldCanonical, newCanonical] = ["68a6d5cf-a4f4-4f4a-86c5-830726badbf6", "3e45fff9-0acd-429c-8696-457f0b19aacc"];
    const original = (await observations.findById(oldId))!, recaptured = (await observations.findById(newId))!;
    expect(original.contentFingerprint).toBe(recaptured.contentFingerprint);
    const stateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%decision%' OR name LIKE '%interaction%' OR name = 'confirmed_organization_roles')").all() as { name: string }[];
    const state = () => stateTables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = state();
    const observationRows = () => db.prepare("SELECT * FROM source_observations WHERE id IN (?, ?) ORDER BY id").all(oldId, newId);
    const rowsBefore = observationRows();
    const acquisition = original.metadata.acquisition as { html: string; pageTitle: string };
    const replay = { pageUrl: original.source.sourceUrl!, pageTitle: acquisition.pageTitle, html: acquisition.html, visibleText: original.rawContent!, capturedAt: "2026-10-25T08:00:00Z" };
    const runtime = createCaptureProcessingRuntime(db);
    const canonicalsBefore = db.prepare("SELECT COUNT(*) AS n FROM canonical_vacancies").get();
    const identical = db.prepare("SELECT COUNT(*) AS n FROM source_observations").get() as { n: number };
    const existingObservationIds = new Set((db.prepare("SELECT id FROM source_observations").all() as { id: string }[]).map(row => row.id));
    const result = await runtime.captureAndProcessBrowserVacancy(replay);
    expect(result.processing).toMatchObject({ status: "PROCESSED", canonicalVacancyId: oldCanonical });
    const recaptureId = result.capture.observationId;
    expect([oldId, newId]).not.toContain(recaptureId);
    expect((await observations.findById(recaptureId))?.source.externalId).toBe("JOBREQ_50273077");
    // A later saved database may already contain the repaired capture. Reuse
    // that immutable observation instead of requiring an extra duplicate.
    expect(db.prepare("SELECT COUNT(*) AS n FROM source_observations").get()).toEqual({ n: identical.n + (existingObservationIds.has(recaptureId) ? 0 : 1) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM canonical_vacancies").get()).toEqual(canonicalsBefore);
    expect(db.prepare("SELECT source_observation_id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id = ? ORDER BY observation_order").all(newCanonical)).toEqual([{ source_observation_id: newId }]);
    expect(db.prepare("SELECT source_observation_id FROM canonical_vacancy_source_observations WHERE canonical_vacancy_id = ? ORDER BY observation_order").all(oldCanonical).map(row => (row as { source_observation_id: string }).source_observation_id)).toEqual(expect.arrayContaining([oldId, recaptureId]));
    expect(observationRows()).toEqual(rowsBefore);
    expect(state()).toEqual(before);
    const again = await runtime.captureAndProcessBrowserVacancy({ ...replay, capturedAt: "2026-10-25T08:01:00Z" });
    expect(again.capture.observationId).toBe(recaptureId);
    expect(again.processing).toMatchObject({ canonicalVacancyId: oldCanonical, observationAdded: false });
  } finally { db.close(); }
});
