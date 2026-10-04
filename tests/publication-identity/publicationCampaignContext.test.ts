import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contextFixture, seedPaths, fm, cm, at, later } from "./publicationContextFixture.js";
import { derivePublicationCampaignContext } from "../../src/application/user/derivePublicationCampaignContext.js";
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));
async function setup(kind: "memory" | "sqlite", status: "UNRESOLVED" | "CONFLICTED" = "UNRESOLVED") { const f = await contextFixture(kind, status); closers.push(f.close); return f; }
for (const kind of ["memory", "sqlite"] as const) describe(`${kind} publication/campaign review context`, () => {
  it("returns empty lists for absent relationships and an empty input", async () => {
    const f = await setup(kind);
    expect(await f.source.findBySourceObservationIds(["a"])).toEqual({ publicationFamilies: [], recruitmentCampaigns: [] });
    expect(await f.source.findBySourceObservationIds([])).toEqual({ publicationFamilies: [], recruitmentCampaigns: [] });
  });
  it("resolves one family with exact recorded provenance", async () => {
    const f = await setup(kind); await f.families.addMembership(fm("m1", "a"));
    const context = await f.source.findBySourceObservationIds(["a"]);
    expect(context.publicationFamilies).toEqual([expect.objectContaining({ id: "f1", representativeTitle: "Title f1", observationCount: 1, currentVacancyObservationIds: ["a"], currentVacancyObservationCount: 1 })]);
    expect(context.publicationFamilies[0]?.membershipEvidence).toEqual([{ ...omitId(fm("m1", "a")), membershipId: "m1" }]);
  });
  it("deduplicates families and providers while including observations from other canonical vacancies", async () => {
    const f = await setup(kind); await seedPaths(f);
    const result = await f.source.findBySourceObservationIds(["b", "a", "c", "a"]);
    expect(result.publicationFamilies.map((x) => x.id)).toEqual(["f1", "f2"]);
    expect(result.publicationFamilies[0]).toMatchObject({ observationCount: 3, currentVacancyObservationIds: ["a", "b"], currentVacancyObservationCount: 2,
      sourceProviders: ["hellowork.com", "indeed.com", "linkedin.com"], firstSeenAt: new Date("2026-09-01"), lastSeenAt: new Date("2026-09-28") });
    expect(await f.source.findBySourceObservationIds(["c", "a", "b"])).toEqual(result);
  });
  it.each(["PROPOSED", "REJECTED", "SUPERSEDED"] as const)("excludes %s family memberships from both discovery and family totals", async (status) => {
    const f = await setup(kind);
    await f.families.addMembership(fm("good", "a"));
    await f.families.addMembership(fm("bad", "inactive", "f1", { status: status === "SUPERSEDED" ? "ACCEPTED" : status }));
    if (status === "SUPERSEDED") await f.families.supersedeMembership("bad", later);
    expect((await f.source.findBySourceObservationIds(["a"])).publicationFamilies[0]).toMatchObject({ observationCount: 1, sourceProviders: ["indeed.com"], firstSeenAt: new Date("2026-09-12") });
    expect((await f.source.findBySourceObservationIds(["inactive"])).publicationFamilies).toEqual([]);
  });
  it("supports direct family-less observation relationships", async () => {
    const f = await setup(kind); await f.campaigns.addMembership(cm("direct", "c1", { sourceObservationId: "a" }));
    const context = await f.source.findBySourceObservationIds(["a"]);
    expect(context.publicationFamilies).toEqual([]);
    expect(context.recruitmentCampaigns[0]?.relationshipPaths).toEqual([expect.objectContaining({ membershipId: "direct", sourceObservationId: "a", pathType: "DIRECT_OBSERVATION", status: "USER_CONFIRMED", confidence: 0.87 })]);
  });
  it("supports multiple campaigns, deduplicates entities and retains all paths", async () => {
    const f = await setup(kind); await seedPaths(f);
    const { recruitmentCampaigns } = await f.source.findBySourceObservationIds(["a", "b", "c"]);
    expect(recruitmentCampaigns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(recruitmentCampaigns[0]).toMatchObject({ status: "ENDED", employerClusterId: "campaign-employer", firstObservedAt: new Date("2025-01-01"), lastObservedAt: at });
    expect(recruitmentCampaigns[0]?.relationshipPaths.map((p) => [p.membershipId, p.pathType])).toEqual([["direct-c1", "DIRECT_OBSERVATION"], ["via-f1", "PUBLICATION_FAMILY"], ["via-f2", "PUBLICATION_FAMILY"]]);
    expect(recruitmentCampaigns[1]?.relationshipPaths).toHaveLength(2);
    expect(recruitmentCampaigns[0]?.relationshipPaths[0]).toMatchObject({ confidence: 0.87, sourceType: "USER_CONFIRMED", algorithm: "manual-review", algorithmVersion: "1", evaluatedAt: at, explanation: "Explicitly confirmed" });
  });
  it.each(["PROPOSED", "REJECTED", "SUPERSEDED"] as const)("excludes %s campaign memberships without filtering campaign entity status", async (status) => {
    const f = await setup(kind);
    await f.campaigns.addMembership(cm("excluded", "c1", { sourceObservationId: "a" }, { status: status === "SUPERSEDED" ? "ACCEPTED" : status }));
    if (status === "SUPERSEDED") await f.campaigns.supersedeMembership("excluded", later);
    expect((await f.source.findBySourceObservationIds(["a"])).recruitmentCampaigns).toEqual([]);
  });
  it("does not follow a direct campaign link of another observation in the family", async () => {
    const f = await setup(kind);
    await f.campaigns.addMembership(cm("external-direct", "c1", { sourceObservationId: "outside" }));
    await f.families.addMembership(fm("current", "a")); await f.families.addMembership(fm("other", "outside"));
    expect((await f.source.findBySourceObservationIds(["a"])).recruitmentCampaigns).toEqual([]);
  });
  it.each(["UNRESOLVED", "CONFLICTED"] as const)("keeps public relationships with %s employers and isolates private actions", async (status) => {
    const f = await setup(kind, status); await seedPaths(f);
    await f.interactions.append({ id: "other-applied", canonicalVacancyId: "other", type: "APPLIED", occurredAt: at, recordedAt: at });
    const review = await f.workflow.getVacancyReview("current");
    expect(review.vacancyContext).toMatchObject({ seenBefore: true, observationCount: 3, sourceCount: 2, sourceProviders: ["hellowork.com", "indeed.com"], appliedBefore: false, rejectedBefore: false });
    expect(review.vacancyContext.publicationFamilies).toHaveLength(2);
    expect(review.vacancyContext.recruitmentCampaigns).toHaveLength(2);
    expect(review.employer.employerClusterId).toBe("current-employer");
    expect(review.employer.status).toBe(status); expect(review.employerHistory).toBeUndefined();
  });
  it("retains relationship context on refreshed action responses", async () => {
    const f = await setup(kind); await seedPaths(f); const before = await f.workflow.getVacancyReview("current");
    const result = await f.workflow.recordVacancyReviewAction({ canonicalVacancyId: "current", type: "APPLIED" });
    expect(result.review.vacancyContext.appliedBefore).toBe(true);
    expect(result.review.vacancyContext.publicationFamilies).toEqual(before.vacancyContext.publicationFamilies);
    expect(result.review.vacancyContext.recruitmentCampaigns).toEqual(before.vacancyContext.recruitmentCampaigns);
  });
});
it("produces identical complete SQLite and in-memory projections", async () => {
  const memory = await setup("memory"); const sqlite = await setup("sqlite");
  await seedPaths(memory); await seedPaths(sqlite);
  expect(await memory.workflow.getVacancyReview("current")).toEqual(await sqlite.workflow.getVacancyReview("current"));
});
it("uses a bounded set of SQLite batched queries in one deferred read transaction", async () => {
  const f = await setup("sqlite"); await seedPaths(f);
  const prepare = vi.spyOn(f.db!, "prepare"); const transaction = vi.spyOn(f.db!, "transaction");
  await f.source.findBySourceObservationIds(["a", "b", "c"]);
  expect(transaction).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(6);
  expect(prepare.mock.calls.every(([sql]) => /^SELECT/.test(sql.trim()))).toBe(true);
});
it("fails explicitly for missing family observations instead of inventing dates/counts", () => {
  expect(() => derivePublicationCampaignContext(["a"], { families: [{ id: "f1", createdAt: at, updatedAt: at }], familyMemberships: [fm("m1", "a")], observations: [], campaigns: [], campaignMemberships: [] })).toThrow('references missing SourceObservation "a"');
});
function omitId<T extends { id: string }>(value: T): Omit<T, "id"> { const { id, ...rest } = value; return rest; }

it("keeps one SQLite snapshot while another connection supersedes a family membership", async () => {
  const path = join(tmpdir(), `jobnearby-m129-${randomUUID()}.sqlite`);
  const f = await contextFixture("sqlite", "UNRESOLVED", path);
  let writer: Database.Database | undefined;
  try {
    f.db!.pragma("journal_mode = WAL"); await seedPaths(f);
    writer = new Database(path); writer.pragma("foreign_keys = ON");
    const original = f.db!.prepare.bind(f.db!); let changed = false;
    const spy = vi.spyOn(f.db!, "prepare").mockImplementation((sql: string) => {
      if (!changed && sql.startsWith("SELECT * FROM publication_families")) {
        changed = true;
        writer!.prepare("UPDATE publication_family_memberships SET superseded_at = ? WHERE id = 'f1-outside'").run(later.toISOString());
      }
      return original(sql);
    });
    const snapshot = await f.source.findBySourceObservationIds(["a"]);
    spy.mockRestore(); expect(changed).toBe(true);
    expect(snapshot.publicationFamilies[0]?.observationCount).toBe(3);
    expect((await f.source.findBySourceObservationIds(["a"])).publicationFamilies[0]?.observationCount).toBe(2);
  } finally {
    writer?.close(); f.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  }
});
it("deduplicates repeated provider IDs and orders evidence by evaluation time before ID", async () => {
  const f = await setup("sqlite");
  await f.families.addMembership(fm("z-earlier", "a", "f1", { evaluatedAt: new Date("2026-09-01") }));
  await f.families.addMembership(fm("a-later", "c"));
  const result = await f.source.findBySourceObservationIds(["a", "c"]);
  expect(result.publicationFamilies[0]?.sourceProviders).toEqual(["indeed.com"]);
  expect(result.publicationFamilies[0]?.membershipEvidence.map((m) => m.membershipId)).toEqual(["z-earlier", "a-later"]);
});
it("does not traverse campaigns through a superseded current family path", async () => {
  const f = await setup("sqlite");
  await f.families.addMembership(fm("family", "a"));
  await f.campaigns.addMembership(cm("campaign", "c1", { publicationFamilyId: "f1" }));
  await f.families.supersedeMembership("family", later);
  expect(await f.source.findBySourceObservationIds(["a"])).toEqual({ publicationFamilies: [], recruitmentCampaigns: [] });
});
