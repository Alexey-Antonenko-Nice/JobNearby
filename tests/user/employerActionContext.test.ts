import { describe, expect, it, vi } from "vitest";
import { getEmployerMemoryView } from "../../src/application/user/getEmployerMemoryView.js";
import { deriveEmployerActionContext } from "../../src/application/user/deriveEmployerActionContext.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import type { EmployerClusterStatus } from "../../src/domain/recognition/EmployerCluster.js";
import type { UserVacancyInteractionEvent, UserVacancyInteractionType } from "../../src/domain/user/UserVacancyInteractionEvent.js";

function event(id: string, type: UserVacancyInteractionType, occurredAt = "2026-01-01", canonicalVacancyId = "past", recordedAt = occurredAt): UserVacancyInteractionEvent {
  return { id, type, canonicalVacancyId, occurredAt: new Date(occurredAt), recordedAt: new Date(recordedAt) };
}
async function context(events: readonly UserVacancyInteractionEvent[] = [], ids = ["past"], status: EmployerClusterStatus = "PROBABLY_RESOLVED") {
  const repository = new InMemoryUserVacancyInteractionRepository();
  for (const value of events) await repository.append(value);
  const batch = vi.spyOn(repository, "findByCanonicalVacancyIds");
  const single = vi.spyOn(repository, "findByCanonicalVacancyId");
  const history = await getEmployerMemoryView("employer", {
    employerClusterRepository: { findById: async () => ({ id: "employer", status, displayLabel: "Air Products", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }) },
    interactionRepository: repository,
    publicDataSource: { findByEmployerClusterId: async () => ids.map((canonicalVacancyId) => ({ canonicalVacancyId, canonicalizationStatus: "PARTIAL", title: "Role", location: null, latestObservedAt: new Date("2026-09-01"), sourceObservationCount: 5, organizationRelationships: [] })) },
    excludeCanonicalVacancyId: "current",
  });
  const before = structuredClone(history);
  const result = deriveEmployerActionContext(history);
  expect(history).toEqual(before);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(single).not.toHaveBeenCalled();
  return result;
}
const empty = { knownEmployer: true, appliedBefore: false, applicationCount: 0, contactedBefore: false, contactCount: 0,
  interviewedBefore: false, interviewCount: 0, offeredBefore: false, offerCount: 0, rejectedBefore: false, rejectionCount: 0,
  withdrawnBefore: false, withdrawalCount: 0, lastApplicationAt: null, lastInteractionAt: null, lastInteractionType: null };

describe("M12.6 employer action context", () => {
  it("knows a usable employer without previous vacancies or interactions", async () => {
    expect(await context([], [])).toEqual(empty);
  });
  it("knows a previously seen employer with no interactions", async () => {
    expect(await context()).toEqual(empty);
  });
  it.each([
    ["APPLIED", "appliedBefore", "applicationCount"], ["CONTACTED", "contactedBefore", "contactCount"],
    ["INTERVIEW", "interviewedBefore", "interviewCount"], ["OFFER", "offeredBefore", "offerCount"],
    ["REJECTED", "rejectedBefore", "rejectionCount"], ["WITHDRAWN", "withdrawnBefore", "withdrawalCount"],
  ] as const)("uses only explicit %s and keeps boolean/count consistent", async (type, flag, count) => {
    const result = await context([event("event", type)]);
    expect(result).toEqual({ ...empty, [flag]: true, [count]: 1, lastApplicationAt: type === "APPLIED" ? new Date("2026-01-01") : null,
      lastInteractionAt: new Date("2026-01-01"), lastInteractionType: type });
  });
  it("counts repeated applications and observations once per canonical vacancy", async () => {
    const result = await context([event("a", "APPLIED"), event("b", "APPLIED", "2026-01-03")], ["past", "past"]);
    expect(result).toMatchObject({ applicationCount: 1, lastApplicationAt: new Date("2026-01-03") });
  });
  it("aggregates two applications and independent outcomes across vacancies", async () => {
    const result = await context([event("a", "APPLIED"), event("b", "REJECTED", "2026-01-15"),
      event("c", "APPLIED", "2026-01-05", "second"), event("d", "INTERVIEW", "2026-01-20", "second")], ["past", "second"]);
    expect(result).toMatchObject({ applicationCount: 2, interviewCount: 1, rejectionCount: 1,
      lastApplicationAt: new Date("2026-01-05"), lastInteractionAt: new Date("2026-01-20"), lastInteractionType: "INTERVIEW" });
  });
  it("preserves the full applied/contacted/interview/rejected timeline", async () => {
    const result = await context([event("r", "REJECTED", "2026-01-15"), event("a", "APPLIED"), event("i", "INTERVIEW", "2026-01-10"), event("c", "CONTACTED", "2026-01-03")]);
    expect(result).toMatchObject({ appliedBefore: true, contactedBefore: true, interviewedBefore: true, rejectedBefore: true,
      lastApplicationAt: new Date("2026-01-01"), lastInteractionAt: new Date("2026-01-15"), lastInteractionType: "REJECTED" });
  });
  it("uses occurredAt rather than recorded/capture time for last application", async () => {
    const result = await context([event("a", "APPLIED", "2026-01-01", "past", "2026-09-01"), event("b", "APPLIED", "2026-02-01")]);
    expect(result?.lastApplicationAt).toEqual(new Date("2026-02-01"));
    expect(result?.lastInteractionAt).toEqual(new Date("2026-02-01"));
  });
  it("uses recordedAt to break global occurredAt ties across vacancies", async () => {
    const result = await context([event("z", "REJECTED", "2026-01-01", "past"), event("a", "CONTACTED", "2026-01-01", "second", "2026-01-02")], ["past", "second"]);
    expect(result?.lastInteractionType).toBe("CONTACTED");
    expect(result?.lastInteractionAt).toEqual(new Date("2026-01-01"));
  });
  it("uses event ID for ties without imposing outcome precedence", async () => {
    const events = [event("a", "OFFER"), event("z", "REVIEWED", "2026-01-01", "second")];
    expect((await context(events, ["past", "second"]))?.lastInteractionType).toBe("REVIEWED");
    expect(await context(events, ["past", "second"])).toEqual(await context([...events].reverse(), ["second", "past"]));
  });
  it("CLOSED does not imply rejected or withdrawn", async () => {
    expect(await context([event("c", "CLOSED")])).toEqual({ ...empty, lastInteractionAt: new Date("2026-01-01"), lastInteractionType: "CLOSED" });
  });
  it("excludes every current vacancy event before counts and timestamps", async () => {
    const events = (["APPLIED", "CONTACTED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"] as const)
      .map((type) => event(type, type, "2026-09-01", "current"));
    expect(await context(events, ["current", "past"])).toEqual(empty);
  });
  it.each(["PROBABLY_RESOLVED", "RESOLVED"] as const)("supports authoritative %s history", async (status) => {
    expect((await context([], [], status))?.knownEmployer).toBe(true);
  });
  it.each(["UNRESOLVED", "CONFLICTED"] as const)("suppresses %s even with interaction history", async (status) => {
    expect(await context([event("a", "APPLIED")], ["past"], status)).toBeNull();
  });
  it("omits context for a missing employer", () => {
    expect(deriveEmployerActionContext(null)).toBeNull();
  });
});
