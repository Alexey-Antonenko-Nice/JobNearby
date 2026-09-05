import { describe, expect, it } from "vitest";

import { getVacancyReviewView } from "../../src/application/user/getVacancyReviewView.js";
import type { EmployerMemoryPublicVacancy } from "../../src/application/user/EmployerMemoryPublicDataSource.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { UserVacancyInteractionEvent, UserVacancyInteractionType } from "../../src/domain/user/UserVacancyInteractionEvent.js";
import type { CanonicalField } from "../../src/domain/vacancies/CanonicalField.js";
import type { CanonicalVacancy, VacancyOrganizationRelationship } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";

describe("getVacancyReviewView", () => {
  it("represents a brand-new vacancy at a new unresolved cluster", async () => {
    const view = await query(canonical("current", ["source-1"], [employer("cluster-1")]), [], [memory("current")]);
    expect(view.user).toMatchObject({ currentState: "NEW", everApplied: false });
    expect(view.employer).toMatchObject({
      employerClusterId: "cluster-1", status: "UNRESOLVED", knownBefore: false,
      previousVacancyCount: 0, previousInteractedVacancyCount: 0,
    });
    expect(view.reviewSignals).toMatchObject({
      isNewVacancy: true, isKnownEmployer: false, alreadyAppliedToThisVacancy: false,
    });
  });

  it("separates repeated public observations from private newness", async () => {
    const view = await query(
      canonical("current", ["source-1", "source-2"], [employer("cluster-1")]),
      [], [memory("current")], undefined,
      [observation("source-1", "2026-09-01"), observation("source-2", "2026-09-02")],
    );
    expect(view.vacancy).toMatchObject({
      sourceObservationCount: 2, latestObservedAt: new Date("2026-09-02T00:00:00Z"),
    });
    expect(view.recognition.sameCanonicalVacancySeenBefore).toBe(true);
    expect(view.reviewSignals).toMatchObject({ isNewVacancy: true, hasMultipleSourceObservations: true });
  });

  it("projects every valid source link", async () => {
    const view = await query(
      canonical("current", ["source-1", "source-2"], [employer("cluster-1")]), [], [memory("current")], undefined,
      [observation("source-1", "2026-09-01", "https://example.com/one"), observation("source-2", "2026-09-02", "https://example.com/two")],
    );
    expect(view.vacancy.sourceLinks.map(({ provider, url }) => ({ provider, url }))).toEqual([
      { provider: "Example", url: "https://example.com/two" }, { provider: "Example", url: "https://example.com/one" },
    ]);
  });

  it("distinguishes applying to this vacancy from previous employer applications", async () => {
    const view = await query(
      canonical("current", ["source-1"], [employer("cluster-1")]),
      [event("current-applied", "current", "APPLIED", "2026-09-02")],
      [memory("current", { everApplied: true, currentUserState: "APPLIED" })],
    );
    expect(view.user.currentState).toBe("APPLIED");
    expect(view.reviewSignals).toMatchObject({
      isNewVacancy: false, alreadyAppliedToThisVacancy: true,
      previouslyAppliedToEmployer: false,
    });
    expect(view.employer.everAppliedToEmployer).toBe(true);
  });

  it("derives prior employer history only from other canonical vacancies", async () => {
    const view = await query(
      canonical("current", ["source-1"], [employer("cluster-1")]),
      [
        event("old-applied", "old", "APPLIED", "2026-08-01"),
        event("old-interview", "old", "INTERVIEW", "2026-08-02"),
        event("old-rejected", "old", "REJECTED", "2026-08-03"),
      ],
      [memory("current"), memory("old", {
        currentUserState: "REJECTED", everApplied: true, everInterviewed: true, everRejected: true,
      })],
    );
    expect(view.reviewSignals).toMatchObject({
      isKnownEmployer: true, alreadyAppliedToThisVacancy: false,
      previouslyAppliedToEmployer: true, previouslyInterviewedWithEmployer: true,
      previouslyRejectedByEmployer: true,
    });
    expect(view.employer).toMatchObject({
      knownBefore: true, previousVacancyCount: 1, previousInteractedVacancyCount: 1,
    });
  });

  it("knows an employer from another vacancy even without private interactions", async () => {
    const view = await query(
      canonical("current", ["source-1"], [employer("cluster-1")]),
      [], [memory("current"), memory("old")],
    );
    expect(view.reviewSignals.isKnownEmployer).toBe(true);
    expect(view.employer).toMatchObject({ previousVacancyCount: 1, previousInteractedVacancyCount: 0 });
    expect(view.recognition.unresolvedEmployer).toBe(true);
  });

  it("remains valid without an employer cluster and never promotes intermediaries", async () => {
    const relationships = [relationship("RECRUITER", "Recruiter B"), relationship("CONSULTANCY", "Consultancy A")];
    const view = await query(canonical("current", ["source-1"], relationships), [], [], null);
    expect(view.employer).toMatchObject({
      employerClusterId: null, status: null, knownBefore: false,
      previousVacancyCount: 0,
    });
    expect(view.recognition.unresolvedEmployer).toBe(true);
    expect(view.organizations.recruiters).toEqual([expect.objectContaining({ rawName: "Recruiter B" })]);
    expect(view.organizations.consultancies).toEqual([expect.objectContaining({ rawName: "Consultancy A" })]);
    expect(view.organizations.employerRelationships).toEqual([]);
  });

  it("does not call a resolved cluster known without another vacancy", async () => {
    const cluster: EmployerCluster = {
      id: "cluster-1", status: "RESOLVED", resolvedEmployerId: "employer-1",
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    };
    const view = await query(
      canonical("current", ["source-1"], [employer("cluster-1")]), [], [memory("current")], cluster,
    );
    expect(view.employer).toMatchObject({ status: "RESOLVED", resolvedEmployerId: "employer-1", knownBefore: false });
    expect(view.reviewSignals.isKnownEmployer).toBe(false);
    expect(view.recognition.unresolvedEmployer).toBe(false);
  });

  it("returns only resolved canonical facts and deterministically groups organization roles", async () => {
    const vacancy = canonical("current", ["source-1"], [
      relationship("RECRUITER", "Zulu"), relationship("RECRUITER", "Alpha"),
      relationship("DISPLAYED_COMPANY", "Displayed"), relationship("CLIENT", "Client"),
      relationship("STAFFING_AGENCY", "Agency"), relationship("UNKNOWN", "Mystery"),
    ]);
    const fields = { ...vacancy,
      role: field("CONFLICTED", { title: "Must not leak" }),
      location: field("UNKNOWN", { rawText: "Must not leak" }),
      engagement: field("RESOLVED", { rawTerms: ["CDI"], normalizedTerms: ["PERMANENT"] }),
      workMode: field("RESOLVED", "HYBRID"),
      compensation: field("RESOLVED", { rawText: "50k EUR", currency: "EUR" }),
    } as CanonicalVacancy;
    const view = await query(fields, [], [], null);
    expect(view.vacancy).toMatchObject({
      title: null, location: null,
      engagement: { rawTerms: ["CDI"], normalizedTerms: ["PERMANENT"] },
      workMode: "HYBRID", compensation: { rawText: "50k EUR", currency: "EUR" },
    });
    expect(view.organizations.recruiters.map(({ rawName }) => rawName)).toEqual(["Alpha", "Zulu"]);
    expect(view.organizations.otherRelationships).toEqual([expect.objectContaining({ rawName: "Mystery" })]);
  });

  it("rejects missing vacancies and ambiguous employer-cluster membership", async () => {
    const base = dependencies([], [], null);
    await expect(getVacancyReviewView("missing", {
      ...base, canonicalVacancyRepository: { findById: async () => null },
    })).rejects.toThrow(/does not exist/u);
    await expect(query(canonical("current", ["source-1"], [
      employer("one"), employer("two"),
    ]), [], [])).rejects.toThrow(/multiple explicit employer-cluster/u);
  });

  it("does not mutate public or private inputs while constructing the view", async () => {
    const vacancy = canonical("current", ["source-1"], [employer("cluster-1")]);
    const events = [event("reviewed", "current", "REVIEWED", "2026-09-01")];
    const publicVacancies = [memory("current")];
    const before = structuredClone({ vacancy, events, publicVacancies });
    await query(vacancy, events, publicVacancies);
    expect({ vacancy, events, publicVacancies }).toEqual(before);
  });
});

async function query(
  vacancy: CanonicalVacancy,
  events: readonly UserVacancyInteractionEvent[],
  publicVacancies: readonly EmployerMemoryPublicVacancy[],
  cluster: EmployerCluster | null | undefined = undefined,
  observations = vacancy.sourceObservationIds.map((id, index) => observation(id, `2026-09-0${index + 1}`)),
) {
  const deps = dependencies(events, publicVacancies, cluster === undefined ? defaultCluster() : cluster, observations);
  return getVacancyReviewView(vacancy.id, {
    ...deps, canonicalVacancyRepository: { findById: async () => vacancy },
  });
}

function dependencies(
  events: readonly UserVacancyInteractionEvent[],
  publicVacancies: readonly EmployerMemoryPublicVacancy[],
  cluster: EmployerCluster | null,
  observations: readonly SourceObservation[] = [observation("source-1", "2026-09-01")],
) {
  const interactionRepository = new InMemoryUserVacancyInteractionRepository();
  for (const event of events) void interactionRepository.append(event);
  return {
    canonicalVacancyRepository: { findById: async () => null },
    sourceObservationRepository: { findById: async (id: string) => observations.find((item) => item.id === id) ?? null },
    interactionRepository,
    employerClusterRepository: { findById: async () => cluster },
    employerMemoryPublicDataSource: { findByEmployerClusterId: async () => publicVacancies },
  };
}

function defaultCluster(): EmployerCluster {
  return { id: "cluster-1", status: "UNRESOLVED", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
}

const derivation = { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-01-01") };
function field<T>(status: CanonicalField<T>["status"], value?: T): CanonicalField<T> {
  return { status, ...(value === undefined ? {} : { value }), supportingEvidenceIds: [], conflictingEvidenceIds: [], derivation };
}

function canonical(id: string, sourceObservationIds: readonly string[], organizationRelationships: readonly VacancyOrganizationRelationship[]): CanonicalVacancy {
  const unknown = field("UNKNOWN");
  return {
    id, sourceObservationIds, evidenceReferences: [], organizationRelationships,
    role: unknown, publicationLanguages: unknown, location: unknown, workMode: unknown,
    remoteEligibleCountries: unknown, travel: unknown, engagement: unknown, compensation: unknown,
    experienceRequirements: unknown, educationRequirements: unknown, skillRequirements: unknown,
    languageRequirements: unknown, functionalContexts: unknown, industryContexts: unknown,
    positionCount: unknown, lifecycleStatus: unknown,
    canonicalizationStatus: "PARTIAL", derivation,
  } as CanonicalVacancy;
}

function relationship(role: VacancyOrganizationRelationship["role"], rawName: string): VacancyOrganizationRelationship {
  return { rawName, role, supportingEvidenceIds: [], derivation };
}

function employer(clusterId: string): VacancyOrganizationRelationship {
  return { employerClusterId: clusterId, role: "EMPLOYER", supportingEvidenceIds: [], derivation };
}

function observation(id: string, date: string, sourceUrl?: string): SourceObservation {
  return { id, source: { sourceType: "JOB_BOARD", sourceName: "Example", ...(sourceUrl === undefined ? {} : { sourceUrl }) }, observedAt: new Date(`${date}T00:00:00Z`), metadata: {} };
}

function event(id: string, vacancyId: string, type: UserVacancyInteractionType, date: string): UserVacancyInteractionEvent {
  return { id, canonicalVacancyId: vacancyId, type, occurredAt: new Date(`${date}T00:00:00Z`), recordedAt: new Date(`${date}T00:00:00Z`) } as UserVacancyInteractionEvent;
}

function memory(
  canonicalVacancyId: string,
  overrides: Partial<EmployerMemoryPublicVacancy & {
    currentUserState: string; everApplied: boolean; everInterviewed: boolean; everRejected: boolean;
  }> = {},
): EmployerMemoryPublicVacancy {
  return {
    canonicalVacancyId, canonicalizationStatus: "PARTIAL", title: null, location: null,
    latestObservedAt: new Date("2026-09-01"), sourceObservationCount: 1,
    organizationRelationships: [], ...overrides,
  } as EmployerMemoryPublicVacancy;
}
