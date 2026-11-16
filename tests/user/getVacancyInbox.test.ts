import { describe, expect, it } from "vitest";

import { getVacancyInbox } from "../../src/application/user/getVacancyInbox.js";
import type { ObservationClusterAssignmentRepository } from "../../src/domain/recognition/ObservationClusterAssignmentRepository.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";

describe("getVacancyInbox", () => {
  it("returns an empty inbox", async () => expect(await query([])).toEqual([]));

  it("derives NEW, sorts newest first, and breaks date ties by ID", async () => {
    const inbox = await query([vacancy("b", ["one"]), vacancy("a", ["two"]), vacancy("newest", ["three"])]);
    expect(inbox.map(({ canonicalVacancyId }) => canonicalVacancyId)).toEqual(["newest", "a", "b"]);
    expect(inbox[0]!.userState).toBe("NEW");
  });

  it("summarizes repeated observations and applied history", async () => {
    const interactions = new InMemoryUserVacancyInteractionRepository();
    await interactions.append({ id: "applied", canonicalVacancyId: "one", type: "APPLIED", occurredAt: new Date("2026-09-03"), recordedAt: new Date("2026-09-03") });
    const inbox = await query([vacancy("one", ["one", "two"])], interactions);
    expect(inbox[0]).toMatchObject({ sourceObservationCount: 2, userState: "APPLIED", signals: { sameCanonicalVacancySeenBefore: true, hasMultipleSourceObservations: true, alreadyAppliedToThisVacancy: true } });
  });

  it("does not infer an employer from recruiter or consultancy context", async () => {
    const inbox = await query([vacancy("one", ["one"], [{ role: "RECRUITER", rawName: "Recruiter" }, { role: "CONSULTANCY", rawName: "Consultancy" }])]);
    expect(inbox[0]!.employer).toMatchObject({ employerClusterId: null, unresolvedEmployer: true });
    expect(inbox[0]!.organizations).toMatchObject({ employerName: null, recruiterNames: ["Recruiter"], consultancyNames: ["Consultancy"] });
  });

  it("reports the effective probable employer cluster separately from its raw employer name", async () => {
    const inbox = await query([
      vacancy("c4374b18-a208-4273-9649-d726b578f709", ["one"], [
        { role: "EMPLOYER", rawName: "Mercedes-Benz Trucks Molsheim SASU" },
        { role: "EMPLOYER", employerClusterId: "db8ccdfa-8694-42bb-adda-57567fbcbc81" },
        { role: "DISPLAYED_COMPANY", rawName: "Mercedes-Benz Trucks Molsheim SASU" },
      ]),
    ], undefined, undefined, {}, {
      id: "db8ccdfa-8694-42bb-adda-57567fbcbc81", status: "PROBABLY_RESOLVED",
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    });
    expect(inbox[0]!.employer).toMatchObject({
      employerClusterId: "db8ccdfa-8694-42bb-adda-57567fbcbc81",
      status: "PROBABLY_RESOLVED", unresolvedEmployer: false,
    });
    expect(inbox[0]!.organizations.employerName).toBe("Mercedes-Benz Trucks Molsheim SASU");
  });

  it("keeps an effective unresolved employer cluster unresolved", async () => {
    const inbox = await query([vacancy("randstad", ["one"], [
      { role: "EMPLOYER", rawName: "Randstad France", employerClusterId: "randstad-cluster" },
    ])], undefined, undefined, {}, {
      id: "randstad-cluster", status: "UNRESOLVED",
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    });
    expect(inbox[0]!.employer).toMatchObject({ status: "UNRESOLVED", unresolvedEmployer: true });
  });

  it("shows Airbus provenance consistently for inferred, reused, unresolved, and conflicted assignments", async () => {
    const cluster = { id: "airbus-cluster", status: "PROBABLY_RESOLVED" as const, displayLabel: "Airbus", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
    const inferred = await query([vacancy("inferred", ["one"], [{ role: "EMPLOYER", employerClusterId: cluster.id }])], undefined, undefined, {}, cluster);
    expect(inferred[0]!.employer).toMatchObject({ displayState: "INFERRED", displayName: "Airbus" });

    const assignment = {
      id: "memory-assignment", sourceObservationId: "one", employerClusterId: cluster.id,
      confidence: 1, status: "ACCEPTED" as const, algorithm: "confirmed-employer-memory",
      algorithmVersion: "1", evaluatedAt: new Date("2026-01-01"),
    };
    const assignmentRepository: ObservationClusterAssignmentRepository = {
      findById: async () => assignment,
      findByObservationId: async () => [assignment],
      findEffectiveByObservationId: async () => assignment,
      findCurrentProposalByObservationId: async () => null,
      save: async () => {},
      replaceCurrentProposal: async () => {},
    };
    const reused = await query([vacancy("reused", ["one"], [{ role: "EMPLOYER", employerClusterId: cluster.id }])], undefined, undefined, {}, cluster, { assignmentRepository });
    expect(reused[0]!.employer).toMatchObject({ displayState: "MEMORY_REUSED", displayName: "Airbus" });

    const displayedOnly = await query([vacancy("displayed", ["one"], [{ role: "DISPLAYED_COMPANY", rawName: "Airbus" }])]);
    expect(displayedOnly[0]!.employer).toMatchObject({ displayState: "UNRESOLVED", displayName: "Airbus" });

    const decision = {
      id: "role-decision", canonicalVacancyId: "human", identityKey: "name:airbus",
      organizationName: "Airbus", normalizedName: "airbus", role: "EMPLOYER" as const,
      previousDecisionId: null, basis: {}, overrideAcknowledged: false, createdAt: new Date("2026-01-01"),
    };
    const humanConfirmed = await query(
      [vacancy("human", ["one"], [{ role: "DISPLAYED_COMPANY", rawName: "Airbus" }])],
      undefined, undefined, {}, null,
      { organizationRoleDecisionRepository: {
        listForVacancy: async () => [decision],
        listForIdentity: async () => [decision],
        findById: async () => decision,
        commit: async () => {},
      } },
    );
    expect(humanConfirmed[0]!.employer).toMatchObject({ displayState: "HUMAN_CONFIRMED", displayName: "Airbus" });

    const conflicted = await query([vacancy("conflicted", ["one"], [{ role: "EMPLOYER", employerClusterId: cluster.id }])], undefined, undefined, {}, { ...cluster, status: "CONFLICTED" });
    expect(conflicted[0]!.employer.displayState).toBe("REVIEW_REQUIRED");
  });

  it("returns null for unknown fields and honors a limit", async () => {
    const inbox = await query([vacancy("a", ["one"]), vacancy("b", ["two"])], undefined, 1);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.title).toBeNull();
    await expect(query([], undefined, 0)).rejects.toThrow(/limit/u);
  });

  it("projects valid source links by newest observation, deduplicates exact URLs, and rejects unsafe URLs", async () => {
    const randstadUrl = "https://www.randstad.fr/emploi/technicien-de-maintenance-fh-en-journee_geispolsheim_307-u24-r000078_01r/";
    const inbox = await query([vacancy("one", ["duplicate", "old", "new", "malformed", "javascript"])], undefined, undefined, {
      duplicate: observation("duplicate", "2026-09-03", "Randstad", randstadUrl),
      old: observation("old", "2026-09-01", "Randstad", randstadUrl),
      new: observation("new", "2026-09-03", "HelloWork", "https://www.hellowork.com/job"),
      malformed: observation("malformed", "2026-09-04", "Example", "not a url"),
      javascript: observation("javascript", "2026-09-05", "Example", "javascript:alert(1)"),
    });
    expect(inbox[0]!.sourceLinks).toEqual([
      { sourceObservationId: "duplicate", provider: "Randstad", url: randstadUrl, observedAt: new Date("2026-09-03") },
      { sourceObservationId: "new", provider: "HelloWork", url: "https://www.hellowork.com/job", observedAt: new Date("2026-09-03") },
    ]);
  });
});

async function query(vacancies: any[], interactions = new InMemoryUserVacancyInteractionRepository(), limit?: number, observations: Record<string, any> = {}, cluster: any = null, dependencyOverrides: Partial<Parameters<typeof getVacancyInbox>[1]> = {}) {
  const dates: Record<string, Date> = { one: new Date("2026-09-01"), two: new Date("2026-09-01"), three: new Date("2026-09-03") };
  return getVacancyInbox(limit === undefined ? {} : { limit }, {
    canonicalVacancyRepository: { findAll: async () => vacancies },
    sourceObservationRepository: { findById: async (id: string) => observations[id] ?? ({ id, source: { sourceType: "JOB_BOARD", sourceName: "Example" }, observedAt: dates[id]!, metadata: {} }) },
    interactionRepository: interactions,
    employerClusterRepository: { findById: async () => cluster },
    employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [] },
    ...dependencyOverrides,
  });
}

function vacancy(id: string, sourceObservationIds: string[], organizationRelationships: any[] = []) {
  const unknown = { status: "UNKNOWN", supportingEvidenceIds: [], conflictingEvidenceIds: [], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: new Date("2026-01-01") } };
  return { id, sourceObservationIds, evidenceReferences: [], organizationRelationships, role: unknown, publicationLanguages: unknown, location: unknown, workMode: unknown, remoteEligibleCountries: unknown, travel: unknown, engagement: unknown, compensation: unknown, experienceRequirements: unknown, educationRequirements: unknown, skillRequirements: unknown, languageRequirements: unknown, functionalContexts: unknown, industryContexts: unknown, positionCount: unknown, lifecycleStatus: unknown, canonicalizationStatus: "PARTIAL", derivation: unknown.derivation };
}

function observation(id: string, observedAt: string, sourceName: string, sourceUrl: string) {
  return { id, source: { sourceType: "JOB_BOARD", sourceName, sourceUrl }, observedAt: new Date(observedAt), metadata: {} };
}