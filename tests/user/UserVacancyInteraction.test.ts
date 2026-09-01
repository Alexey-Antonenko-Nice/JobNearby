import { describe, expect, it } from "vitest";

import { getUserVacancyHistory } from "../../src/application/user/getUserVacancyHistory.js";
import { recordUserVacancyInteraction } from "../../src/application/user/recordUserVacancyInteraction.js";
import { deriveUserVacancyState, type UserVacancyInteractionEvent, type UserVacancyInteractionType } from "../../src/domain/user/UserVacancyInteractionEvent.js";
import type { CanonicalVacancy } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";

const vacancy = { id: "canonical-1" } as CanonicalVacancy;

describe("private user vacancy interaction history", () => {
  it("derives NEW when no events exist", async () => {
    expect(await getUserVacancyHistory("canonical-1", new InMemoryUserVacancyInteractionRepository()))
      .toEqual({ canonicalVacancyId: "canonical-1", currentState: "NEW", events: [] });
  });

  it.each([
    [["REVIEWED"], "REVIEWED"],
    [["REVIEWED", "INTERESTED"], "INTERESTED"],
    [["INTERESTED", "APPLIED"], "APPLIED"],
    [["APPLIED", "CONTACTED"], "CONTACTED"],
    [["CONTACTED", "INTERVIEW"], "INTERVIEW"],
    [["INTERVIEW", "OFFER"], "OFFER"],
  ] as const)("derives the latest state for %j", async (types, expected) => {
    const repository = new InMemoryUserVacancyInteractionRepository();
    for (const [index, type] of types.entries()) await repository.append(event(
      `${index}`, type, new Date(`2026-09-0${index + 1}T00:00:00Z`),
    ));
    expect((await getUserVacancyHistory("canonical-1", repository)).currentState).toBe(expected);
  });

  it("preserves non-linear and repeated history without transition rejection", async () => {
    const repository = new InMemoryUserVacancyInteractionRepository();
    for (const [index, type] of ["APPLIED", "REJECTED", "INTERESTED", "INTERESTED"].entries()) {
      await repository.append(event(`${index}`, type as UserVacancyInteractionType,
        new Date(`2026-09-0${index + 1}T00:00:00Z`)));
    }
    const history = await getUserVacancyHistory("canonical-1", repository);
    expect(history.events.map(({ type }) => type)).toEqual([
      "APPLIED", "REJECTED", "INTERESTED", "INTERESTED",
    ]);
    expect(history.currentState).toBe("INTERESTED");
  });

  it("orders by occurredAt, recordedAt, then stable event ID", () => {
    const occurredAt = new Date("2026-09-01T10:00:00Z");
    const laterRecorded = event("a", "OFFER", occurredAt, new Date("2026-09-02T00:00:00Z"));
    const idWinner = event("z", "CLOSED", occurredAt, new Date("2026-09-02T00:00:00Z"));
    const recordedEarlier = event("zz", "REVIEWED", occurredAt, new Date("2026-09-01T00:00:00Z"));
    expect(deriveUserVacancyState([idWinner, recordedEarlier, laterRecorded])).toBe("CLOSED");
  });

  it("records typed metadata, defaults occurredAt, and returns resulting state", async () => {
    const repository = new InMemoryUserVacancyInteractionRepository();
    const now = new Date("2026-09-01T12:00:00Z");
    const result = await recordUserVacancyInteraction({
      canonicalVacancyId: vacancy.id,
      type: "APPLIED",
      metadata: { channel: "LINKEDIN", sourceObservationId: "source-1" },
    }, {
      canonicalVacancyRepository: { findById: async () => vacancy },
      interactionRepository: repository,
      now: () => now,
      generateId: () => "application-event",
    });
    expect(result.event).toEqual({
      id: "application-event", canonicalVacancyId: vacancy.id, type: "APPLIED",
      occurredAt: now, recordedAt: now,
      metadata: { channel: "LINKEDIN", sourceObservationId: "source-1" },
    });
    expect(result.history.currentState).toBe("APPLIED");
  });

  it("does not append when the canonical vacancy does not exist", async () => {
    const repository = new InMemoryUserVacancyInteractionRepository();
    await expect(recordUserVacancyInteraction({ canonicalVacancyId: "missing", type: "REVIEWED" }, {
      canonicalVacancyRepository: { findById: async () => null }, interactionRepository: repository,
    })).rejects.toThrow(/does not exist/u);
    expect(await repository.findByCanonicalVacancyId("missing")).toEqual([]);
  });
});

function event(
  id: string,
  type: UserVacancyInteractionType,
  occurredAt: Date,
  recordedAt = occurredAt,
): UserVacancyInteractionEvent {
  return { id, canonicalVacancyId: "canonical-1", type, occurredAt, recordedAt } as UserVacancyInteractionEvent;
}
