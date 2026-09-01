import { describe, expect, it } from "vitest";

import { getEmployerMemoryView } from "../../src/application/user/getEmployerMemoryView.js";
import type { EmployerMemoryPublicVacancy } from "../../src/application/user/EmployerMemoryPublicDataSource.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { UserVacancyInteractionEvent, UserVacancyInteractionType } from "../../src/domain/user/UserVacancyInteractionEvent.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";

const unresolved: EmployerCluster = {
  id: "cluster-1", status: "UNRESOLVED",
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("getEmployerMemoryView", () => {
  it("returns a valid empty view for a cluster with zero vacancies", async () => {
    const view = await query([], []);
    expect(view.employerCluster).toEqual({ id: "cluster-1", status: "UNRESOLVED" });
    expect(view.vacancies).toEqual([]);
    expect(view.organizationsSeen).toEqual([]);
    expect(view.summary).toEqual({
      vacancyCount: 0, interactedVacancyCount: 0,
      everAppliedCount: 0, everInterviewedCount: 0, everRejectedCount: 0,
      currentStateCounts: {}, latestVacancyObservedAt: null, latestUserInteractionAt: null,
    });
  });

  it("represents a vacancy with no private history as NEW", async () => {
    const view = await query([vacancy("new", "2026-09-01T00:00:00Z")], []);
    expect(view.vacancies[0]).toMatchObject({
      canonicalVacancyId: "new", currentUserState: "NEW", lastUserInteractionAt: null,
    });
    expect(view.summary).toMatchObject({
      vacancyCount: 1, interactedVacancyCount: 0, currentStateCounts: { NEW: 1 },
    });
  });

  it("preserves unavailable title and location as null", async () => {
    const unknown = { ...vacancy("unknown", null), title: null, location: null };
    const view = await query([unknown], []);
    expect(view.vacancies[0]).toMatchObject({ title: null, location: null, latestObservedAt: null });
  });

  it("sorts vacancies by latest observation descending and ID ascending", async () => {
    const view = await query([
      vacancy("z-old", "2026-08-01T00:00:00Z"),
      vacancy("b-tie", "2026-09-01T00:00:00Z"),
      vacancy("a-tie", "2026-09-01T00:00:00Z"),
      vacancy("no-observation", null),
    ], []);
    expect(view.vacancies.map(({ canonicalVacancyId }) => canonicalVacancyId))
      .toEqual(["a-tie", "b-tie", "z-old", "no-observation"]);
  });

  it("preserves history-derived ever metrics after the current state changes", async () => {
    const events = [
      interaction("1", "history", "APPLIED", "2026-09-01"),
      interaction("2", "history", "INTERVIEW", "2026-09-02"),
      interaction("3", "history", "REJECTED", "2026-09-03"),
    ];
    const view = await query([
      vacancy("history", "2026-09-04T00:00:00Z"),
      vacancy("new", "2026-09-05T00:00:00Z"),
    ], events);
    expect(view.vacancies.find(({ canonicalVacancyId }) => canonicalVacancyId === "history"))
      .toMatchObject({
        currentUserState: "REJECTED", everApplied: true,
        everInterviewed: true, everRejected: true,
        lastUserInteractionAt: new Date("2026-09-03T00:00:00Z"),
      });
    expect(view.summary).toMatchObject({
      vacancyCount: 2, interactedVacancyCount: 1,
      everAppliedCount: 1, everInterviewedCount: 1, everRejectedCount: 1,
      currentStateCounts: { NEW: 1, REJECTED: 1 },
    });
  });

  it("uses M6.1 ordering for non-linear history", async () => {
    const view = await query([vacancy("nonlinear", "2026-09-05T00:00:00Z")], [
      interaction("1", "nonlinear", "APPLIED", "2026-09-01"),
      interaction("2", "nonlinear", "REJECTED", "2026-09-02"),
      interaction("3", "nonlinear", "INTERESTED", "2026-09-03"),
    ]);
    expect(view.vacancies[0]).toMatchObject({
      currentUserState: "INTERESTED", everApplied: true, everRejected: true,
    });
  });

  it("aggregates conservative repeated names by role without promoting intermediaries", async () => {
    const relationship = (role: "RECRUITER" | "CONSULTANCY") => ({ rawName: "Akkodis-France", role });
    const view = await query([
      { ...vacancy("one", "2026-09-01T00:00:00Z", 2), organizationRelationships: [relationship("RECRUITER"), relationship("CONSULTANCY")] },
      { ...vacancy("two", "2026-09-02T00:00:00Z", 3), organizationRelationships: [
        { rawName: "akkodis france", role: "RECRUITER" }, relationship("CONSULTANCY"),
      ] },
    ], []);
    expect(view.organizationsSeen).toEqual([
      { rawName: "Akkodis-France", role: "CONSULTANCY", canonicalVacancyIds: ["one", "two"], observationCount: 5 },
      { rawName: "Akkodis-France", role: "RECRUITER", canonicalVacancyIds: ["one", "two"], observationCount: 5 },
    ]);
    expect(view.vacancies.every(({ recruiterConsultancyRelationships }) =>
      recruiterConsultancyRelationships.every(({ role }) => role !== "EMPLOYER"))).toBe(true);
  });

  it("preserves resolved cluster identity and rejects a missing cluster", async () => {
    const resolved = { ...unresolved, status: "RESOLVED" as const, resolvedEmployerId: "employer-1" };
    expect((await query([], [], resolved)).employerCluster).toEqual({
      id: "cluster-1", status: "RESOLVED", resolvedEmployerId: "employer-1",
    });
    await expect(getEmployerMemoryView("missing", {
      employerClusterRepository: { findById: async () => null },
      publicDataSource: { findByEmployerClusterId: async () => [] },
      interactionRepository: new InMemoryUserVacancyInteractionRepository(),
    })).rejects.toThrow(/does not exist/u);
  });
});

async function query(
  vacancies: readonly EmployerMemoryPublicVacancy[],
  events: readonly UserVacancyInteractionEvent[],
  cluster = unresolved,
) {
  const interactionRepository = new InMemoryUserVacancyInteractionRepository();
  for (const event of events) await interactionRepository.append(event);
  return getEmployerMemoryView(cluster.id, {
    employerClusterRepository: { findById: async () => cluster },
    publicDataSource: { findByEmployerClusterId: async () => vacancies },
    interactionRepository,
  });
}

function vacancy(
  canonicalVacancyId: string,
  observedAt: string | null,
  sourceObservationCount = 1,
): EmployerMemoryPublicVacancy {
  return {
    canonicalVacancyId, canonicalizationStatus: "USABLE",
    title: "Engineer", location: { rawText: "Strasbourg" },
    latestObservedAt: observedAt === null ? null : new Date(observedAt),
    sourceObservationCount, organizationRelationships: [],
  };
}

function interaction(
  id: string,
  canonicalVacancyId: string,
  type: UserVacancyInteractionType,
  date: string,
): UserVacancyInteractionEvent {
  return {
    id, canonicalVacancyId, type,
    occurredAt: new Date(`${date}T00:00:00Z`), recordedAt: new Date(`${date}T00:00:00Z`),
  } as UserVacancyInteractionEvent;
}
