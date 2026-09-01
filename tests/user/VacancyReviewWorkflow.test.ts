import { describe, expect, it } from "vitest";

import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import type { RecordUserVacancyInteractionInput } from "../../src/application/user/recordUserVacancyInteraction.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { CanonicalVacancy } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import { adsearchVacancy, heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

describe("VacancyReviewWorkflow", () => {
  it("reads NEW without recording REVIEWED implicitly", async () => {
    const fixture = setup();
    expect((await fixture.workflow.getVacancyReview(fixture.current.id)).user.currentState).toBe("NEW");
    expect((await fixture.workflow.getVacancyReview(fixture.current.id)).user.currentState).toBe("NEW");
    expect(await fixture.interactions.findByCanonicalVacancyId(fixture.current.id)).toEqual([]);
  });

  it("records REVIEWED and APPLIED and immediately refreshes the review", async () => {
    const fixture = setup();
    const reviewed = await fixture.workflow.recordVacancyReviewAction({
      canonicalVacancyId: fixture.current.id, type: "REVIEWED",
    });
    expect(reviewed.event.type).toBe("REVIEWED");
    expect(reviewed.review.user.currentState).toBe("REVIEWED");
    expect(reviewed.review.reviewSignals.isNewVacancy).toBe(false);

    const applied = await fixture.workflow.recordVacancyReviewAction({
      canonicalVacancyId: fixture.current.id, type: "APPLIED",
      metadata: { channel: "EMPLOYER_SITE", sourceObservationId: "heuft-a" },
    });
    expect(applied.review.user.currentState).toBe("APPLIED");
    expect(applied.review.reviewSignals.alreadyAppliedToThisVacancy).toBe(true);
    expect((await fixture.interactions.findByCanonicalVacancyId(fixture.current.id))
      .map(({ type }) => type)).toEqual(["REVIEWED", "APPLIED"]);
  });

  it("preserves repeated CONTACTED and INTERVIEW events", async () => {
    const fixture = setup();
    for (const type of ["CONTACTED", "CONTACTED", "INTERVIEW", "INTERVIEW"] as const) {
      await fixture.workflow.recordVacancyReviewAction({ canonicalVacancyId: fixture.current.id, type });
    }
    expect((await fixture.interactions.findByCanonicalVacancyId(fixture.current.id))
      .map(({ type }) => type)).toEqual(["CONTACTED", "CONTACTED", "INTERVIEW", "INTERVIEW"]);
  });

  it("propagates an application to another vacancy through employer memory", async () => {
    const fixture = setup();
    await fixture.workflow.recordVacancyReviewAction({ canonicalVacancyId: fixture.current.id, type: "APPLIED" });
    const other = await fixture.workflow.getVacancyReview(fixture.other.id);
    expect(other.user.currentState).toBe("NEW");
    expect(other.reviewSignals).toMatchObject({
      isKnownEmployer: true, alreadyAppliedToThisVacancy: false,
      previouslyAppliedToEmployer: true,
    });
  });

  it("reuses M6.1 validation and never stores invalid metadata", async () => {
    const fixture = setup();
    await expect(fixture.workflow.recordVacancyReviewAction({
      canonicalVacancyId: fixture.current.id, type: "APPLIED",
      metadata: { channel: "INVALID" },
    } as unknown as RecordUserVacancyInteractionInput)).rejects.toThrow(/invalid value/u);
    expect(await fixture.interactions.findByCanonicalVacancyId(fixture.current.id)).toEqual([]);
  });
});

function setup() {
  const clusterId = "shared-cluster";
  const current = withCluster(heuftVacancy(), clusterId);
  const other = withCluster(adsearchVacancy(), clusterId);
  const vacancies = new Map([[current.id, current], [other.id, other]]);
  const observations = new Map<string, SourceObservation>([
    ["heuft-a", observation("heuft-a")], ["heuft-b", observation("heuft-b")],
    ["observation-1", observation("observation-1")],
  ]);
  const interactions = new InMemoryUserVacancyInteractionRepository();
  let sequence = 0;
  const workflow = createVacancyReviewWorkflow({
    canonicalVacancyRepository: { findById: async (id) => vacancies.get(id) ?? null },
    sourceObservationRepository: { findById: async (id) => observations.get(id) ?? null },
    interactionRepository: interactions,
    employerClusterRepository: { findById: async () => ({
      id: clusterId, status: "UNRESOLVED",
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    }) },
    employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [
      publicVacancy(current), publicVacancy(other),
    ] },
    now: () => new Date(`2026-09-01T00:00:0${sequence}.000Z`),
    generateId: () => `event-${++sequence}`,
  });
  return { workflow, interactions, current, other };
}

function withCluster(vacancy: CanonicalVacancy, employerClusterId: string): CanonicalVacancy {
  return {
    ...vacancy,
    organizationRelationships: vacancy.organizationRelationships.map((relationship) =>
      relationship.role === "EMPLOYER" ? { ...relationship, employerClusterId } : relationship),
  };
}

function observation(id: string): SourceObservation {
  return {
    id, source: { sourceType: "JOB_BOARD", sourceName: "Example" },
    observedAt: new Date("2026-09-01"), metadata: {},
  };
}

function publicVacancy(vacancy: CanonicalVacancy) {
  return {
    canonicalVacancyId: vacancy.id, canonicalizationStatus: vacancy.canonicalizationStatus,
    title: vacancy.role.value?.title ?? null, location: vacancy.location.value ?? null,
    latestObservedAt: new Date("2026-09-01"), sourceObservationCount: vacancy.sourceObservationIds.length,
    organizationRelationships: vacancy.organizationRelationships.map(
      ({ organizationId, employerClusterId, rawName, role }) => ({
        ...(organizationId === undefined ? {} : { organizationId }),
        ...(employerClusterId === undefined ? {} : { employerClusterId }),
        ...(rawName === undefined ? {} : { rawName }), role,
      }),
    ),
  };
}
