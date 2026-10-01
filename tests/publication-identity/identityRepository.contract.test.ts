import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { InMemoryPublicationFamilyRepository } from "../../src/infrastructure/persistence/InMemoryPublicationFamilyRepository.js";
import { SqlitePublicationFamilyRepository } from "../../src/infrastructure/persistence/SqlitePublicationFamilyRepository.js";
import { InMemoryRecruitmentCampaignRepository } from "../../src/infrastructure/persistence/InMemoryRecruitmentCampaignRepository.js";
import { SqliteRecruitmentCampaignRepository } from "../../src/infrastructure/persistence/SqliteRecruitmentCampaignRepository.js";
import type { PublicationFamily, PublicationFamilyMembership, PublicationFamilyRepository } from "../../src/domain/publication-identity/PublicationFamily.js";
import type { RecruitmentCampaign, RecruitmentCampaignMembership, RecruitmentCampaignRepository } from "../../src/domain/publication-identity/RecruitmentCampaign.js";
import type { MembershipDecision } from "../../src/domain/publication-identity/MembershipDecision.js";

const date = new Date("2026-10-01T12:00:00Z");
const later = new Date("2026-10-02T12:00:00Z");
export const family = (id = "f1"): PublicationFamily => ({ id, createdAt: date, updatedAt: date, representativeTitle: "Technician" });
export const campaign = (id = "c1"): RecruitmentCampaign => ({ id, employerClusterId: "employer", status: "UNKNOWN", firstObservedAt: date, lastObservedAt: date, createdAt: date, updatedAt: date });
const decision = (id: string): MembershipDecision => ({ id, confidence: 0.9, status: "USER_CONFIRMED", algorithm: "explicit-membership", algorithmVersion: "1", evaluatedAt: date, createdAt: date, sourceType: "USER_CONFIRMED", explanation: "Explicit decision" });
export const familyMember = (overrides: Partial<PublicationFamilyMembership> = {}): PublicationFamilyMembership => ({ ...decision("fm1"), publicationFamilyId: "f1", sourceObservationId: "o1", ...overrides });
export const campaignMember = (overrides: Record<string, unknown> = {}): RecruitmentCampaignMembership => ({ ...decision("cm1"), recruitmentCampaignId: "c1", sourceObservationId: "o1", ...overrides } as RecruitmentCampaignMembership);
const close: (() => void)[] = [];
afterEach(() => { close.splice(0).forEach((fn) => fn()); });
async function setup(kind: "memory" | "sqlite") {
  const db = kind === "sqlite" ? createDatabase(":memory:") : null;
  if (db) close.push(() => db.close());
  const observations = db ? new SqliteSourceObservationRepository(db) : new InMemorySourceObservationRepository();
  const employers = db ? new SqliteEmployerClusterRepository(db) : new InMemoryEmployerClusterRepository();
  for (const id of ["o1", "o2", "o3"]) await observations.save({ id, source: { sourceName: "indeed.com", sourceType: "JOB_BOARD" }, observedAt: date, metadata: {} });
  await employers.save({ id: "employer", status: "UNRESOLVED", createdAt: date, updatedAt: date });
  const memoryFamilies = new InMemoryPublicationFamilyRepository(observations);
  const families: PublicationFamilyRepository = db ? new SqlitePublicationFamilyRepository(db) : memoryFamilies;
  const campaigns: RecruitmentCampaignRepository = db ? new SqliteRecruitmentCampaignRepository(db) : new InMemoryRecruitmentCampaignRepository(observations, employers, memoryFamilies);
  await families.save(family()); await families.save(family("f2"));
  await campaigns.save(campaign()); await campaigns.save(campaign("c2"));
  return { families, campaigns, db };
}
for (const kind of ["memory", "sqlite"] as const) describe(`${kind} identity repository contracts`, () => {
  it("creates and reads entities without canonical vacancies or resolved employer identity", async () => {
    const { families, campaigns } = await setup(kind);
    expect(await families.findById("f1")).toEqual(family());
    expect(await campaigns.findById("c1")).toEqual(campaign());
    expect(await campaigns.findByEmployerClusterId("employer")).toEqual([campaign(), campaign("c2")]);
    expect(await families.findById("absent")).toBeNull(); expect(await campaigns.findById("absent")).toBeNull();
  });
  it("round-trips campaign descriptive fields and uncertainty", async () => {
    const { campaigns } = await setup(kind);
    const value: RecruitmentCampaign = { ...campaign("full"), status: "PROBABLY_ACTIVE", occupation: { id: "tech", canonicalName: "Technician", classificationSystem: "ESCO", classificationCode: "x" }, location: { city: "Lyon", countryCode: "FR" }, positionCount: { type: "RANGE", minimum: 2, maximum: 4 } };
    await campaigns.save(value); expect(await campaigns.findById("full")).toEqual(value);
  });
  it("rejects duplicate entity IDs", async () => {
    const { families, campaigns } = await setup(kind);
    await expect(families.save(family())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(campaigns.save(campaign())).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects a campaign with missing employer", async () => {
    const { campaigns } = await setup(kind);
    await expect(campaigns.save({ ...campaign("bad"), employerClusterId: "missing" })).rejects.toMatchObject({ code: "MISSING_REFERENCE", message: 'EmployerCluster "missing" does not exist.' });
  });
  it("assigns observations and reads family membership", async () => {
    const { families } = await setup(kind); await families.addMembership(familyMember());
    expect(await families.findBySourceObservationId("o1")).toEqual(family());
    expect(await families.findActiveMembershipBySourceObservationId("o1")).toEqual(familyMember());
    expect(await families.findMembersByFamilyId("f1")).toEqual([familyMember()]);
    expect(await families.findBySourceObservationId("o2")).toBeNull();
  });
  it("allows many observations in a family with deterministic time/ID ordering", async () => {
    const { families } = await setup(kind);
    const items = [familyMember({ id: "z", sourceObservationId: "o2" }), familyMember({ id: "a" }), familyMember({ id: "early", sourceObservationId: "o3", evaluatedAt: new Date("2026-09-01") })];
    for (const item of items) await families.addMembership(item);
    expect((await families.findMembersByFamilyId("f1")).map((m) => m.id)).toEqual(["early", "a", "z"]);
  });
  it("replays identical family decisions including a retry with a new ID/recording time", async () => {
    const { families } = await setup(kind); const original = await families.addMembership(familyMember());
    expect(await families.addMembership(familyMember())).toEqual(original);
    expect(await families.addMembership(familyMember({ id: "retry", createdAt: later }))).toEqual(original);
    expect(await families.findMembershipHistoryBySourceObservationId("o1")).toHaveLength(1);
  });
  it("fails closed for conflicting active families and changed provenance on active relationship", async () => {
    const { families } = await setup(kind); await families.addMembership(familyMember());
    await expect(families.addMembership(familyMember({ id: "conflict", publicationFamilyId: "f2" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(families.addMembership(familyMember({ id: "different", explanation: "Changed decision" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await families.findBySourceObservationId("o1")).toEqual(family());
  });
  it("rejects ID reuse for a different decision", async () => {
    const { families, campaigns } = await setup(kind); await families.addMembership(familyMember());
    await expect(families.addMembership(familyMember({ sourceObservationId: "o2" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await campaigns.addMembership(campaignMember({ sourceObservationId: "o2" }));
    await expect(campaigns.addMembership(campaignMember({ sourceObservationId: "o3" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["family", "observation"])("rejects missing %s on family membership", async (which) => {
    const { families } = await setup(kind);
    await expect(families.addMembership(familyMember(which === "family" ? { publicationFamilyId: "missing" } : { sourceObservationId: "missing" }))).rejects.toMatchObject({ code: "MISSING_REFERENCE" });
  });
  it("supersedes without erasing audit and permits a new family decision", async () => {
    const { families } = await setup(kind); await families.addMembership(familyMember());
    await families.supersedeMembership("fm1", later); await families.supersedeMembership("fm1", later);
    expect(await families.findBySourceObservationId("o1")).toBeNull();
    await families.addMembership(familyMember({ id: "replacement", publicationFamilyId: "f2", evaluatedAt: later, createdAt: later }));
    expect(await families.findBySourceObservationId("o1")).toEqual(family("f2"));
    expect(await families.addMembership(familyMember())).toEqual({ ...familyMember(), supersededAt: later });
    expect(await families.findMembershipHistoryBySourceObservationId("o1")).toHaveLength(2);
    expect(await families.findMembersByFamilyId("f1")).toEqual([]);
  });
  it("keeps proposed/rejected decisions out of active family lookups", async () => {
    const { families } = await setup(kind);
    await families.addMembership(familyMember({ id: "proposal", status: "PROPOSED" }));
    await families.addMembership(familyMember({ id: "rejected", status: "REJECTED", publicationFamilyId: "f2" }));
    expect(await families.findBySourceObservationId("o1")).toBeNull();
    await families.addMembership(familyMember({ status: "ACCEPTED" }));
    expect(await families.findMembersByFamilyId("f1")).toHaveLength(1);
    expect(await families.findMembershipHistoryBySourceObservationId("o1")).toHaveLength(3);
  });
  it.each(["observation", "family"])("supports multiple campaigns per %s and deterministic lookups", async (targetKind) => {
    const { campaigns } = await setup(kind);
    const target = targetKind === "family" ? { publicationFamilyId: "f1", sourceObservationId: undefined } : { sourceObservationId: "o1" };
    await campaigns.addMembership(campaignMember({ ...target, id: "z", recruitmentCampaignId: "c2" }));
    await campaigns.addMembership(campaignMember({ ...target, id: "a" }));
    const query = targetKind === "family" ? { publicationFamilyId: "f1" } : { sourceObservationId: "o1" };
    expect((await campaigns.findByTarget(query)).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect((await campaigns.findActiveMembershipsByTarget(query)).map((m) => m.id)).toEqual(["a", "z"]);
    expect(await campaigns.findMembersByCampaignId("c1")).toHaveLength(1);
  });
  it("allows many targets in a single campaign", async () => {
    const { campaigns } = await setup(kind);
    await campaigns.addMembership(campaignMember());
    await campaigns.addMembership(campaignMember({ id: "cm2", sourceObservationId: "o2" }));
    expect(await campaigns.findMembersByCampaignId("c1")).toHaveLength(2);
  });
  it("replays campaign decisions but rejects a new duplicate active relationship", async () => {
    const { campaigns } = await setup(kind); const original = await campaigns.addMembership(campaignMember());
    expect(await campaigns.addMembership(campaignMember())).toEqual(original);
    expect(await campaigns.addMembership(campaignMember({ id: "retry", createdAt: later }))).toEqual(original);
    await expect(campaigns.addMembership(campaignMember({ id: "new", algorithmVersion: "2" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await campaigns.findMembershipHistoryByTarget({ sourceObservationId: "o1" })).toHaveLength(1);
  });
  it.each([{}, { publicationFamilyId: "f1", sourceObservationId: "o1" }])("rejects non-XOR target %j", async (target) => {
    const { campaigns } = await setup(kind);
    await expect(campaigns.addMembership(campaignMember({ sourceObservationId: undefined, ...target }))).rejects.toMatchObject({ code: "INVALID" });
  });
  it.each(["campaign", "family", "observation"])("rejects missing %s on campaign membership", async (which) => {
    const { campaigns } = await setup(kind);
    const changes = which === "campaign" ? { recruitmentCampaignId: "missing" } : which === "family" ? { publicationFamilyId: "missing", sourceObservationId: undefined } : { sourceObservationId: "missing" };
    await expect(campaigns.addMembership(campaignMember(changes))).rejects.toMatchObject({ code: "MISSING_REFERENCE" });
  });
  it("rejects new direct memberships for a family member but allows the family target", async () => {
    const { families, campaigns } = await setup(kind); await families.addMembership(familyMember());
    await expect(campaigns.addMembership(campaignMember())).rejects.toMatchObject({ code: "CONFLICT", message: "Target the active publication family instead of its observation." });
    await campaigns.addMembership(campaignMember({ publicationFamilyId: "f1", sourceObservationId: undefined }));
    expect(await campaigns.findByTarget({ publicationFamilyId: "f1" })).toEqual([campaign()]);
  });
  it("preserves existing direct membership and exact replay after joining a family", async () => {
    const { families, campaigns } = await setup(kind); const original = await campaigns.addMembership(campaignMember());
    await families.addMembership(familyMember());
    expect(await campaigns.findMembershipById("cm1")).toEqual(original);
    expect(await campaigns.addMembership(campaignMember({ id: "retry" }))).toEqual(original);
    await expect(campaigns.addMembership(campaignMember({ id: "new", recruitmentCampaignId: "c2" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await campaigns.findActiveMembershipsByTarget({ sourceObservationId: "o1" })).toEqual([original]);
  });
  it("allows direct membership after explicit family supersession", async () => {
    const { families, campaigns } = await setup(kind); await families.addMembership(familyMember());
    await families.supersedeMembership("fm1", later); await campaigns.addMembership(campaignMember());
    expect(await campaigns.findMembersByCampaignId("c1")).toHaveLength(1);
  });
  it("preserves superseded campaign decisions and does not resurrect them on replay", async () => {
    const { campaigns } = await setup(kind); await campaigns.addMembership(campaignMember());
    await campaigns.supersedeMembership("cm1", later);
    expect(await campaigns.findByTarget({ sourceObservationId: "o1" })).toEqual([]);
    expect(await campaigns.addMembership(campaignMember())).toMatchObject({ supersededAt: later });
    await campaigns.addMembership(campaignMember({ id: "new", evaluatedAt: later, createdAt: later }));
    expect(await campaigns.findMembershipHistoryByTarget({ sourceObservationId: "o1" })).toHaveLength(2);
    expect(await campaigns.findActiveMembershipsByTarget({ sourceObservationId: "o1" })).toHaveLength(1);
  });
  it("rejects invalid supersession and preserves active state", async () => {
    const { families, campaigns } = await setup(kind); await families.addMembership(familyMember());
    await expect(families.supersedeMembership("fm1", new Date("2020-01-01"))).rejects.toMatchObject({ code: "INVALID" });
    await expect(campaigns.supersedeMembership("missing", later)).rejects.toMatchObject({ code: "MISSING_REFERENCE" });
    expect(await families.findActiveMembershipBySourceObservationId("o1")).not.toBeNull();
    await families.supersedeMembership("fm1", later);
    await expect(families.supersedeMembership("fm1", new Date("2026-10-03"))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([{ confidence: -1 }, { confidence: NaN }, { algorithm: " " }, { status: "FAKE" }, { sourceType: "AUTO" }, { evaluatedAt: new Date(NaN) }, { supersededAt: later }])("rejects invalid decision %j", async (changes) => {
    const { families, campaigns } = await setup(kind);
    await expect(families.addMembership({ ...familyMember(), ...changes } as PublicationFamilyMembership)).rejects.toMatchObject({ code: "INVALID" });
    await expect(campaigns.addMembership(campaignMember(changes))).rejects.toMatchObject({ code: "INVALID" });
  });
  it("keeps proposed/rejected campaign decisions in history without effective membership", async () => {
    const { campaigns } = await setup(kind);
    await campaigns.addMembership(campaignMember({ id: "proposed", status: "PROPOSED" }));
    await campaigns.addMembership(campaignMember({ id: "rejected", status: "REJECTED" }));
    expect(await campaigns.findByTarget({ sourceObservationId: "o1" })).toEqual([]);
    expect(await campaigns.findMembershipHistoryByTarget({ sourceObservationId: "o1" })).toHaveLength(2);
  });
  it("does not treat proposed/rejected family decisions as active family ownership", async () => {
    const { families, campaigns } = await setup(kind);
    await families.addMembership(familyMember({ status: "PROPOSED" }));
    await families.addMembership(familyMember({ id: "rejected", status: "REJECTED" }));
    await campaigns.addMembership(campaignMember());
    expect(await campaigns.findMembersByCampaignId("c1")).toHaveLength(1);
  });
  it("rejects invalid entity dates and campaign counts", async () => {
    const { families, campaigns } = await setup(kind);
    await expect(families.save({ ...family("invalid"), updatedAt: new Date("2000-01-01") })).rejects.toMatchObject({ code: "INVALID" });
    await expect(campaigns.save({ ...campaign("invalid"), lastObservedAt: new Date("2000-01-01") })).rejects.toMatchObject({ code: "INVALID" });
    await expect(campaigns.save({ ...campaign("invalid"), positionCount: { type: "RANGE", minimum: 4, maximum: 2 } })).rejects.toMatchObject({ code: "INVALID" });
    await expect(campaigns.save({ ...campaign("invalid"), positionCount: { type: "EXACT", value: -1 } })).rejects.toMatchObject({ code: "INVALID" });
  });
  it("keeps both family-target and grandfathered direct decisions explicitly visible", async () => {
    const { families, campaigns } = await setup(kind);
    await campaigns.addMembership(campaignMember()); await families.addMembership(familyMember());
    await campaigns.addMembership(campaignMember({ id: "family-campaign", publicationFamilyId: "f1", sourceObservationId: undefined }));
    expect(await campaigns.findMembersByCampaignId("c1")).toHaveLength(2);
    await campaigns.supersedeMembership("cm1", later);
    expect(await campaigns.findActiveMembershipsByTarget({ sourceObservationId: "o1" })).toEqual([]);
    expect(await campaigns.findActiveMembershipsByTarget({ publicationFamilyId: "f1" })).toHaveLength(1);
  });
  it("defensively clones stored values and results", async () => {
    const { families } = await setup(kind); const value = familyMember(); await families.addMembership(value);
    const result = await families.findMembershipById("fm1"); result!.createdAt.setUTCFullYear(2000);
    expect((await families.findMembershipById("fm1"))!.createdAt).toEqual(date);
  });
  it("serializes competing family assignments without two active winners", async () => {
    const { families } = await setup(kind);
    const results = await Promise.allSettled([families.addMembership(familyMember()), families.addMembership(familyMember({ id: "second", publicationFamilyId: "f2" }))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await families.findMembershipHistoryBySourceObservationId("o1")).toHaveLength(1);
  });
});
