import { describe, expect, it } from "vitest";
import { deriveVacancyContext } from "../../src/application/user/deriveVacancyContext.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { UserVacancyInteractionEvent, UserVacancyInteractionType } from "../../src/domain/user/UserVacancyInteractionEvent.js";

const observation = (id: string, provider = "indeed.com", day = 1): SourceObservation => ({
  id, source: { sourceType: "JOB_BOARD", sourceName: provider },
  observedAt: new Date(Date.UTC(2026, 8, day)), publishedAt: new Date("2020-01-01"), metadata: {},
});
const event = (type: UserVacancyInteractionType, overrides: Partial<UserVacancyInteractionEvent> = {}): UserVacancyInteractionEvent => ({
  id: "event", canonicalVacancyId: "current", type, occurredAt: new Date("2026-09-10"), recordedAt: new Date("2026-09-11"), ...overrides,
} as UserVacancyInteractionEvent);
const context = (observations: SourceObservation[] = [observation("a")], events: UserVacancyInteractionEvent[] = []) => deriveVacancyContext("current", observations, events);

describe("vacancy context", () => {
  it("is first-time seen with one immutable observation and no actions", () => {
    expect(context()).toMatchObject({ seenBefore: false, observationCount: 1, sourceCount: 1, latestInteractionType: null, latestInteractionAt: null, appliedBefore: false });
  });
  it("counts distinct observations, not repeated processing", () => {
    expect(context([observation("a"), observation("a")])).toMatchObject({ seenBefore: false, observationCount: 1 });
  });
  it("counts three sightings from one provider as one source", () => {
    expect(context([observation("a"), observation("b"), observation("c")])).toMatchObject({ seenBefore: true, observationCount: 3, sourceCount: 1 });
  });
  it("normalizes providers with existing identity rules and orders deterministically", () => {
    const observations = [observation("a", "Indeed.com"), observation("b", "hellowork.com"), observation("c", " indeed.com ")];
    expect(context(observations)).toMatchObject({ sourceCount: 2, sourceProviders: ["hellowork.com", "indeed.com"] });
    expect(context(observations.reverse())).toEqual(context(observations));
  });
  it("uses observedAt extrema, never publication or interaction dates", () => {
    expect(context([observation("b", "indeed.com", 28), observation("a", "indeed.com", 12)], [event("APPLIED")])).toMatchObject({
      firstSeenAt: new Date("2026-09-12"), lastSeenAt: new Date("2026-09-28"),
    });
  });
  it("keeps current source unknown on the canonical-only route even with one provider", () => {
    expect(context()).toMatchObject({ currentSourceObservationId: null, currentSourceProvider: null });
  });
  it("handles empty observations without fabricated timestamps", () => {
    expect(context([])).toMatchObject({ seenBefore: false, observationCount: 0, sourceCount: 0, firstSeenAt: null, lastSeenAt: null });
  });
  it.each([
    ["REVIEWED", "reviewedBefore"], ["INTERESTED", "interestedBefore"], ["APPLIED", "appliedBefore"],
    ["CONTACTED", "contactedBefore"], ["INTERVIEW", "interviewedBefore"], ["OFFER", "offeredBefore"],
    ["REJECTED", "rejectedBefore"], ["WITHDRAWN", "withdrawnBefore"], ["CLOSED", "closedBefore"],
  ] as const)("derives %s only from private events on this canonical vacancy", (type, flag) => {
    expect(context(undefined, [event(type)])[flag]).toBe(true);
    expect(context(undefined, [event(type, { canonicalVacancyId: "other" })])[flag]).toBe(false);
  });
  it("uses occurredAt before recordedAt and preserves historical applied flag", () => {
    expect(context(undefined, [event("CLOSED"), event("APPLIED", { occurredAt: new Date("2026-08-01"), recordedAt: new Date("2027-01-01") })])).toMatchObject({ latestInteractionType: "CLOSED", latestInteractionAt: new Date("2026-09-10"), appliedBefore: true });
  });
  it("breaks occurredAt ties by recordedAt", () => {
    expect(context(undefined, [event("APPLIED", { recordedAt: new Date("2026-09-12") }), event("CLOSED")]).latestInteractionType).toBe("APPLIED");
  });
  it("breaks timestamp ties by event ID", () => {
    expect(context(undefined, [event("REJECTED", { id: "z" }), event("APPLIED", { id: "a" })]).latestInteractionType).toBe("REJECTED");
  });
  it("resolves application provenance from its referenced member, not the latest provider", () => {
    expect(context([observation("a"), observation("b", "hellowork.com", 28)], [event("APPLIED", { metadata: { sourceObservationId: "a" } })])).toMatchObject({ appliedBefore: true, appliedViaProvider: "indeed.com", appliedViaSourceObservationId: "a" });
  });
  it.each([undefined, "missing", "other-vacancy-observation"])("does not invent application provenance for %s", (sourceObservationId) => {
    expect(context(undefined, [event("APPLIED", sourceObservationId ? { metadata: { sourceObservationId } } : {})])).toMatchObject({ appliedBefore: true, appliedViaProvider: null, appliedViaSourceObservationId: null });
  });
  it("does not borrow provenance from an older application when latest has none", () => {
    expect(context(undefined, [event("APPLIED", { id: "a", metadata: { sourceObservationId: "a" } }), event("APPLIED", { id: "z" })]).appliedViaProvider).toBeNull();
  });
  it("does not expose deferred family or campaign fields", () => {
    expect(context()).not.toHaveProperty("publicationFamily");
    expect(context()).not.toHaveProperty("recruitmentCampaign");
  });
});
