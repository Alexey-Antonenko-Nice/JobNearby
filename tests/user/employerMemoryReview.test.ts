import { confirmVacancyEmployer } from "../../src/application/user/confirmVacancyEmployer.js";
import { describe, expect, it } from "vitest";
import { getEmployerMemoryReviewCandidates, decideEmployerMemoryReview } from "../../src/application/user/employerMemoryReview.js";
import { getVacancyReviewView } from "../../src/application/user/getVacancyReviewView.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";
import type { EmployerClusterStatus } from "../../src/domain/recognition/EmployerCluster.js";
import type { ObservationClusterAssignmentStatus } from "../../src/domain/recognition/ObservationClusterAssignment.js";
import type { VacancyOrganizationRole } from "../../src/domain/vacancies/CanonicalVacancy.js";

const date = new Date("2026-09-07T00:00:00Z");
function setup() {
  const base = heuftVacancy();
  const vacancy = { ...base, sourceObservationIds: ["current"], organizationRelationships: [{ role: "DISPLAYED_COMPANY" as VacancyOrganizationRole, rawName: "ACME", supportingEvidenceIds: [], derivation: base.derivation }] };
  const deps = { employerClusterRepository: new InMemoryEmployerClusterRepository(), assignmentRepository: new InMemoryObservationClusterAssignmentRepository() };
  async function add(id: string, status: ObservationClusterAssignmentStatus = "USER_CONFIRMED", clusterStatus: EmployerClusterStatus = "PROBABLY_RESOLVED", name = "ACME", observationId = `prior-${id}`) {
    await deps.employerClusterRepository.save({ id, status: clusterStatus, displayLabel: name, createdAt: date, updatedAt: date, ...(clusterStatus === "RESOLVED" ? { resolvedEmployerId: "legal" } : {}) });
    await deps.assignmentRepository.save(createObservationClusterAssignment({ sourceObservationId: observationId, employerClusterId: id, status, confidence: 1, algorithm: "fixture", algorithmVersion: "1" }));
  }
  return { vacancy, deps, add };
}

describe("employer memory ambiguity review", () => {
  it("derives two ordered candidates with historical evidence without writes", async () => {
    const { vacancy, deps, add } = setup(); await add("b"); await add("a");
    const candidates = await getEmployerMemoryReviewCandidates(vacancy, deps);
    expect(candidates.map((c) => c.employerClusterId)).toEqual(["a", "b"]);
    expect(candidates[0]).toMatchObject({ reasonCodes: ["MULTIPLE_CONFIRMED_CLUSTERS"], priorConfirmationExists: true, priorConfirmationCount: 1, currentOrganizationName: "ACME" });
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual(candidates);
    expect(await deps.assignmentRepository.findByObservationId("current")).toHaveLength(0);
  });
  it("compares normalized names exactly despite differing repository search normalization", async () => {
    const { vacancy, deps, add } = setup();
    vacancy.organizationRelationships[0]!.rawName = "ACME France";
    await add("a", "USER_CONFIRMED", "PROBABLY_RESOLVED", "ACME-France");
    await add("b", "USER_CONFIRMED", "PROBABLY_RESOLVED", "ACME  France");
    await add("unrelated", "USER_CONFIRMED", "PROBABLY_RESOLVED", "ACME France Group");
    expect((await getEmployerMemoryReviewCandidates(vacancy, deps)).map((c) => c.employerClusterId)).toEqual(["a", "b"]);
  });
  it("does not manufacture review for one exact compatible memory", async () => {
    const { vacancy, deps, add } = setup(); await add("a");
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it.each(["STAFFING_AGENCY", "RECRUITER", "CLIENT", "CONSULTANCY", "EMPLOYER"] as const)("suppresses unsafe %s evidence", async (role) => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b");
    vacancy.organizationRelationships.push({ ...vacancy.organizationRelationships[0]!, role, rawName: role === "EMPLOYER" ? "Other" : "ACME" });
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it.each(["ACCEPTED", "PROPOSED"] as const)("does not source candidates from %s history", async (status) => {
    const { vacancy, deps, add } = setup(); await add("a", status); await add("b", status);
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it("excludes conflicted historical memory", async () => {
    const { vacancy, deps, add } = setup(); await add("a", "USER_CONFIRMED", "CONFLICTED"); await add("b");
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it("offers exact memory for multiple displayed names without alias inference", async () => {
    const { vacancy, deps, add } = setup(); await add("a");
    vacancy.organizationRelationships.push({ ...vacancy.organizationRelationships[0]!, rawName: "ACME France" });
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toMatchObject([{ employerClusterId: "a", reasonCodes: ["MULTIPLE_CURRENT_EMPLOYER_NAMES"] }]);
  });
  it.each(["PROBABLY_RESOLVED", "RESOLVED"] as const)("protects current %s identity", async (status) => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b"); await add("current-cluster", "ACCEPTED", status, "Other", "current");
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
    await expect(decideEmployerMemoryReview(vacancy, "a", "CONFIRM", deps)).rejects.toThrow("no longer eligible");
  });
  it("does not manufacture a conflict with the same named non-final assignment", async () => {
    const { vacancy, deps, add } = setup(); await add("a", "USER_CONFIRMED", "UNRESOLVED");
    await deps.assignmentRepository.save(createObservationClusterAssignment({ sourceObservationId: "current", employerClusterId: "a", status: "ACCEPTED", confidence: 1, algorithm: "matcher", algorithmVersion: "1" }));
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it("reviews a named non-final conflicting assignment", async () => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("current-cluster", "ACCEPTED", "UNRESOLVED", "Other", "current");
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toMatchObject([{ reasonCodes: ["CONFLICTING_EFFECTIVE_ASSIGNMENT"] }]);
  });
  it("confirms the selected existing cluster, preserving history and superseding anonymous membership idempotently", async () => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b"); await add("anonymous", "ACCEPTED", "UNRESOLVED", "Unknown employer", "current");
    await decideEmployerMemoryReview(vacancy, "b", "CONFIRM", deps);
    await decideEmployerMemoryReview(vacancy, "b", "CONFIRM", deps);
    expect(await deps.assignmentRepository.findEffectiveByObservationId("current")).toMatchObject({ status: "USER_CONFIRMED", employerClusterId: "b" });
    expect(await deps.assignmentRepository.findByObservationId("current")).toHaveLength(2);
    expect(await deps.assignmentRepository.findEffectiveByObservationId("prior-b")).toMatchObject({ status: "USER_CONFIRMED" });
    expect(await deps.employerClusterRepository.findById("b")).toMatchObject({ status: "PROBABLY_RESOLVED" });
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it("persists rejection, keeps the remaining ambiguity and handles repeated rejection", async () => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b");
    await decideEmployerMemoryReview(vacancy, "a", "REJECT", deps);
    await decideEmployerMemoryReview(vacancy, "a", "REJECT", deps);
    expect(await deps.assignmentRepository.findByObservationId("current")).toHaveLength(1);
    expect(await deps.assignmentRepository.findEffectiveByObservationId("current")).toBeNull();
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toMatchObject([{ employerClusterId: "b", reasonCodes: ["MULTIPLE_CONFIRMED_CLUSTERS"] }]);
    await expect(decideEmployerMemoryReview(vacancy, "a", "CONFIRM", deps)).rejects.toThrow("no longer eligible");
  });
  it("keeps rejection across added observations and blocks the generic confirmation shortcut", async () => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b");
    await decideEmployerMemoryReview(vacancy, "a", "REJECT", deps);
    await decideEmployerMemoryReview(vacancy, "b", "REJECT", deps);
    vacancy.sourceObservationIds.push("new-observation");
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
    await expect(confirmVacancyEmployer(vacancy.id, "ACME", { ...deps, canonicalVacancyRepository: { findById: async () => vacancy } })).rejects.toThrow("rejected");
  });
  it("does not treat confirmations on this vacancy as historical memory", async () => {
    const { vacancy, deps, add } = setup(); await add("a", "USER_CONFIRMED", "PROBABLY_RESOLVED", "ACME", "current"); await add("b");
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toEqual([]);
  });
  it("uses an existing recognition review proposal only with confirmed historical memory", async () => {
    const { vacancy, deps, add } = setup(); await add("a");
    await deps.assignmentRepository.save(createObservationClusterAssignment({ sourceObservationId: "current", employerClusterId: "a", status: "PROPOSED", confidence: 0.7, algorithm: "matcher", algorithmVersion: "1" }));
    expect(await getEmployerMemoryReviewCandidates(vacancy, deps)).toMatchObject([{ employerClusterId: "a", reasonCodes: ["RECOGNITION_REVIEW_REQUIRED"] }]);
  });

  it("rejects non-candidate IDs", async () => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b");
    await expect(decideEmployerMemoryReview(vacancy, "made-up", "REJECT", deps)).rejects.toThrow("no longer eligible");
    expect(await deps.assignmentRepository.findByObservationId("current")).toHaveLength(0);
  });
  it("exposes review and confirmation history in the read model", async () => {
    const { vacancy, deps, add } = setup(); await add("a"); await add("b");
    const review = await getVacancyReviewView(vacancy.id, { ...deps, canonicalVacancyRepository: { findById: async () => vacancy }, sourceObservationRepository: { findById: async (id) => ({ id, source: { sourceType: "JOB_BOARD", sourceName: "test" }, observedAt: date, metadata: {} }) }, interactionRepository: new InMemoryUserVacancyInteractionRepository(), employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [] } });
    expect(review.employerMemoryReview).toMatchObject({ required: true, candidates: [{ employerClusterId: "a", priorConfirmationCount: 1 }, { employerClusterId: "b" }] });
    expect(review.employer.confirmationCandidate).toBeNull();
    expect(review.employer.employerClusterId).toBeNull();
  });
});
