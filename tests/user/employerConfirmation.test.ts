import { describe, expect, it } from "vitest";

import { confirmVacancyEmployer } from "../../src/application/user/confirmVacancyEmployer.js";
import { employerConfirmationCandidate } from "../../src/application/user/employerConfirmation.js";
import { getVacancyInbox } from "../../src/application/user/getVacancyInbox.js";
import { getVacancyReviewView } from "../../src/application/user/getVacancyReviewView.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import type { CanonicalVacancy } from "../../src/domain/vacancies/CanonicalVacancy.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";

const candidate = "Air Products S.A.S (FR)";
const oldCluster: EmployerCluster = { id: "anonymous", status: "UNRESOLVED", createdAt: date(), updatedAt: date() };

function vacancy(relationships = [{ role: "DISPLAYED_COMPANY", rawName: candidate }]): CanonicalVacancy {
  const unknown = { status: "UNKNOWN", supportingEvidenceIds: [], conflictingEvidenceIds: [], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: date() } };
  return {
    id: "vacancy-1", sourceObservationIds: ["observation-1"], evidenceReferences: [], organizationRelationships: relationships.map((value) => ({ ...value, supportingEvidenceIds: [], derivation: unknown.derivation })),
    role: unknown, publicationLanguages: unknown, location: unknown, workMode: unknown, remoteEligibleCountries: unknown, travel: unknown, engagement: unknown, compensation: unknown, experienceRequirements: unknown, educationRequirements: unknown, skillRequirements: unknown, languageRequirements: unknown, functionalContexts: unknown, industryContexts: unknown, positionCount: unknown, lifecycleStatus: unknown, canonicalizationStatus: "PARTIAL", derivation: unknown.derivation,
  } as CanonicalVacancy;
}

function dependencies(current = vacancy()) {
  const clusters = new InMemoryEmployerClusterRepository();
  const assignments = new InMemoryObservationClusterAssignmentRepository();
  const interactions = new InMemoryUserVacancyInteractionRepository();
  return {
    clusters, assignments, interactions,
    canonicalVacancyRepository: { findById: async () => current, findAll: async () => [current] },
    sourceObservationRepository: { findById: async (id: string) => ({ id, source: { sourceType: "JOB_BOARD" as const, sourceName: "Indeed" }, observedAt: date(), metadata: {} }) },
    employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [] },
  };
}

function date(): Date { return new Date("2026-09-06T12:00:00Z"); }

describe("human employer confirmation", () => {
  it("offers only one clean displayed-company candidate", () => {
    const relationship = (role: string, rawName: string) => ({ role, rawName }) as any;
    expect(employerConfirmationCandidate([relationship("DISPLAYED_COMPANY", candidate)])).toBe(candidate);
    expect(employerConfirmationCandidate([relationship("DISPLAYED_COMPANY", candidate), relationship("DISPLAYED_COMPANY", "Other")])).toBeNull();
    expect(employerConfirmationCandidate([relationship("DISPLAYED_COMPANY", "Randstad France"), relationship("STAFFING_AGENCY", "Randstad France")])).toBeNull();
    expect(employerConfirmationCandidate([relationship("CLIENT", candidate)])).toBeNull();
    expect(employerConfirmationCandidate([relationship("RECRUITER", candidate)])).toBeNull();
    expect(employerConfirmationCandidate([relationship("DISPLAYED_COMPANY", candidate), relationship("EMPLOYER", "Other")])).toBeNull();
  });

  it("persists an auditable user-confirmed assignment and is idempotent", async () => {
    const deps = dependencies();
    await deps.clusters.save(oldCluster);
    await confirmVacancyEmployer("vacancy-1", candidate, {
      canonicalVacancyRepository: deps.canonicalVacancyRepository,
      employerClusterRepository: deps.clusters,
      assignmentRepository: deps.assignments,
      now: date,
      generateId: () => "confirmed-cluster",
    });
    const assignment = await deps.assignments.findEffectiveByObservationId("observation-1");
    expect(assignment).toMatchObject({ status: "USER_CONFIRMED", employerClusterId: "confirmed-cluster", algorithm: "user-employer-confirmation" });
    expect((await deps.clusters.findById("confirmed-cluster"))).toMatchObject({ status: "PROBABLY_RESOLVED", displayLabel: candidate });
    await confirmVacancyEmployer("vacancy-1", candidate, {
      canonicalVacancyRepository: deps.canonicalVacancyRepository,
      employerClusterRepository: deps.clusters,
      assignmentRepository: deps.assignments,
      now: date,
      generateId: () => "should-not-be-created",
    });
    expect(await deps.assignments.findByObservationId("observation-1")).toHaveLength(1);
  });

  it("supersedes an automatic accepted assignment to an anonymous unresolved cluster", async () => {
    const deps = dependencies(); await deps.clusters.save(oldCluster);
    await deps.assignments.save(createObservationClusterAssignment({
      sourceObservationId: "observation-1", employerClusterId: oldCluster.id, confidence: 1,
      status: "ACCEPTED", algorithm: "new-employer-cluster", algorithmVersion: "0.1.0",
      explanation: "New unresolved employer cluster created for this observation.",
    }, { now: date, generateId: () => "automatic-assignment" }));
    await confirmVacancyEmployer("vacancy-1", candidate, { canonicalVacancyRepository: deps.canonicalVacancyRepository, employerClusterRepository: deps.clusters, assignmentRepository: deps.assignments, now: date, generateId: () => "confirmed-cluster" });
    const history = await deps.assignments.findByObservationId("observation-1");
    expect(history).toHaveLength(2);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "automatic-assignment", status: "ACCEPTED" }),
      expect.objectContaining({ status: "USER_CONFIRMED", employerClusterId: "confirmed-cluster" }),
    ]));
    expect(await deps.assignments.findEffectiveByObservationId("observation-1")).toMatchObject({ status: "USER_CONFIRMED", employerClusterId: "confirmed-cluster" });
  });

  it("strengthens a same-name probably-resolved assignment without creating a second cluster", async () => {
    const deps = dependencies();
    const namedCluster: EmployerCluster = { id: "named", status: "PROBABLY_RESOLVED", displayLabel: candidate, createdAt: date(), updatedAt: date() };
    await deps.clusters.save(namedCluster);
    await deps.assignments.save(createObservationClusterAssignment({ sourceObservationId: "observation-1", employerClusterId: namedCluster.id, confidence: 1, status: "ACCEPTED", algorithm: "recognition", algorithmVersion: "1" }, { now: date, generateId: () => "machine-assignment" }));
    await confirmVacancyEmployer("vacancy-1", candidate, { canonicalVacancyRepository: deps.canonicalVacancyRepository, employerClusterRepository: deps.clusters, assignmentRepository: deps.assignments, now: date, generateId: () => "unused" });
    expect(await deps.assignments.findEffectiveByObservationId("observation-1")).toMatchObject({ status: "USER_CONFIRMED", employerClusterId: "named" });
    expect(await deps.clusters.findById("unused")).toBeNull();
  });

  it("rejects definitive and differently named employer assignments", async () => {
    const resolvedDeps = dependencies();
    const resolved: EmployerCluster = { id: "resolved", status: "RESOLVED", resolvedEmployerId: "employer", displayLabel: "Other Company", createdAt: date(), updatedAt: date() };
    await resolvedDeps.clusters.save(resolved);
    await resolvedDeps.assignments.save(createObservationClusterAssignment({ sourceObservationId: "observation-1", employerClusterId: resolved.id, confidence: 1, status: "ACCEPTED", algorithm: "recognition", algorithmVersion: "1" }, { now: date, generateId: () => "resolved-assignment" }));
    await expect(confirmVacancyEmployer("vacancy-1", candidate, { canonicalVacancyRepository: resolvedDeps.canonicalVacancyRepository, employerClusterRepository: resolvedDeps.clusters, assignmentRepository: resolvedDeps.assignments })).rejects.toThrow(/current employer state/u);

    const probableDeps = dependencies();
    const probable: EmployerCluster = { id: "probable", status: "PROBABLY_RESOLVED", displayLabel: "Other Company", createdAt: date(), updatedAt: date() };
    await probableDeps.clusters.save(probable);
    await probableDeps.assignments.save(createObservationClusterAssignment({ sourceObservationId: "observation-1", employerClusterId: probable.id, confidence: 1, status: "ACCEPTED", algorithm: "recognition", algorithmVersion: "1" }, { now: date, generateId: () => "probable-assignment" }));
    await expect(confirmVacancyEmployer("vacancy-1", candidate, { canonicalVacancyRepository: probableDeps.canonicalVacancyRepository, employerClusterRepository: probableDeps.clusters, assignmentRepository: probableDeps.assignments })).rejects.toThrow(/current employer identity/u);
  });

  it("projects the confirmed employer into review and inbox", async () => {
    const deps = dependencies(); await deps.clusters.save(oldCluster);
    await confirmVacancyEmployer("vacancy-1", candidate, { canonicalVacancyRepository: deps.canonicalVacancyRepository, employerClusterRepository: deps.clusters, assignmentRepository: deps.assignments, now: date, generateId: () => "confirmed-cluster" });
    const base = { canonicalVacancyRepository: deps.canonicalVacancyRepository, sourceObservationRepository: deps.sourceObservationRepository, interactionRepository: deps.interactions, employerClusterRepository: deps.clusters, employerMemoryPublicDataSource: deps.employerMemoryPublicDataSource, assignmentRepository: deps.assignments };
    const review = await getVacancyReviewView("vacancy-1", base);
    expect(review.employer).toMatchObject({ employerClusterId: "confirmed-cluster", status: "PROBABLY_RESOLVED", confirmationCandidate: null });
    const inbox = await getVacancyInbox({}, { ...base, interactionRepository: deps.interactions });
    expect(inbox[0]!.employer).toMatchObject({ employerClusterId: "confirmed-cluster", status: "PROBABLY_RESOLVED", unresolvedEmployer: false });
  });

  it("rejects arbitrary candidate names", async () => {
    const deps = dependencies(); await expect(confirmVacancyEmployer("vacancy-1", "Not the displayed company", { canonicalVacancyRepository: deps.canonicalVacancyRepository, employerClusterRepository: deps.clusters, assignmentRepository: deps.assignments })).rejects.toThrow(/no longer eligible/u);
  });
});
