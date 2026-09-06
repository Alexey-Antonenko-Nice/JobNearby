import { expect, it, vi } from "vitest";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { employerConfirmationCandidate } from "../../src/application/user/employerConfirmation.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { InMemoryUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/InMemoryUserVacancyInteractionRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

// Exercise identical application calls against both real assignment repositories.
// Reject all candidates so generic-prompt suppression cannot pass merely because
// another memory candidate still requires review.
it.each(["in-memory", "SQLite"] as const)("%s: rejecting memory preserves the effective unresolved employer through reprocessing", async (kind) => {
  const db = kind === "SQLite" ? createDatabase(":memory:") : null;
  const clusters = db ? new SqliteEmployerClusterRepository(db) : new InMemoryEmployerClusterRepository();
  const assignments = db ? new SqliteObservationClusterAssignmentRepository(db) : new InMemoryObservationClusterAssignmentRepository();
  const date = new Date("2026-09-07T00:00:00Z");
  const observation: SourceObservation = { id: "current", source: { sourceType: "JOB_BOARD", sourceName: "test" }, observedAt: date, displayedCompanyName: "ACME", metadata: {} };
  const base = heuftVacancy();
  const current = {
    ...base,
    sourceObservationIds: [observation.id],
    organizationRelationships: [{ role: "DISPLAYED_COMPANY" as const, rawName: "ACME", supportingEvidenceIds: base.organizationRelationships[0]!.supportingEvidenceIds, derivation: base.derivation }],
  };
  try {
    if (db) {
      const sources = new SqliteSourceObservationRepository(db);
      for (const id of ["current", "prior-a", "prior-b"]) await sources.save({ ...observation, id });
    }
    await clusters.save({ id: "anonymous", status: "UNRESOLVED", displayLabel: "Unknown employer", createdAt: date, updatedAt: date });
    const accepted = createObservationClusterAssignment({ sourceObservationId: "current", employerClusterId: "anonymous", status: "ACCEPTED", confidence: 1, algorithm: "new-employer-cluster", algorithmVersion: "0.1.0" }, { now: () => date, generateId: () => "original-accepted" });
    await assignments.save(accepted);
    for (const id of ["a", "b"]) {
      await clusters.save({ id, status: "PROBABLY_RESOLVED", displayLabel: "ACME", createdAt: date, updatedAt: date });
      await assignments.save(createObservationClusterAssignment({ sourceObservationId: `prior-${id}`, employerClusterId: id, status: "USER_CONFIRMED", confidence: 1, algorithm: "user-employer-confirmation", algorithmVersion: "1" }, { now: () => date }));
    }
    const workflow = createVacancyReviewWorkflow({
      canonicalVacancyRepository: { findById: async () => current, findAll: async () => [current] },
      sourceObservationRepository: { findById: async () => observation },
      employerClusterRepository: clusters, employerClusterWriter: clusters, assignmentRepository: assignments,
      interactionRepository: new InMemoryUserVacancyInteractionRepository(),
      employerMemoryPublicDataSource: { findByEmployerClusterId: async () => [] },
    });
    expect(employerConfirmationCandidate(current.organizationRelationships)).toBe("ACME");
    expect((await workflow.getVacancyReview(current.id)).employerMemoryReview?.candidates.map((c) => c.employerClusterId)).toEqual(["a", "b"]);
    const findBestMatch = vi.fn(async () => { throw new Error("Existing effective membership must bypass matching."); });
    const saveNewClusterWithAssignment = vi.fn(async () => { throw new Error("Reprocessing must not create another assignment."); });

    for (const [index, employerClusterId] of ["a", "b"].entries()) {
      await workflow.decideEmployerMemoryReview({ canonicalVacancyId: current.id, employerClusterId, decision: "REJECT" });
      const history = await assignments.findByObservationId("current");
      expect(history).toHaveLength(index + 2);
      expect(history).toContainEqual(accepted);
      expect(history.find((a) => a.employerClusterId === employerClusterId)).toMatchObject({ status: "REJECTED", algorithm: "user-employer-memory-review" });
      // A later REJECTED row is history, not an effective membership in either lookup.
      expect(await assignments.findEffectiveByObservationId("current")).toEqual(accepted);
      expect(await assignments.findEffectiveByClusterId("anonymous")).toEqual([accepted]);
      expect((await assignments.findEffectiveByClusterId(employerClusterId)).map((a) => a.sourceObservationId)).toEqual([`prior-${employerClusterId}`]);

      const result = await processObservation(observation, {
        clusterRepository: clusters, assignmentRepository: assignments,
        matcher: { findBestMatch }, recognitionPersistence: { saveNewClusterWithAssignment },
        policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 }, algorithm: "test", algorithmVersion: "1",
      });
      expect(result).toMatchObject({ outcome: "MATCHED_EXISTING_CLUSTER", employerCluster: { id: "anonymous", status: "UNRESOLVED" }, assignment: accepted });
      expect(await assignments.findByObservationId("current")).toEqual(history);
      const review = await workflow.getVacancyReview(current.id);
      expect(review.employer).toMatchObject({ employerClusterId: "anonymous", status: "UNRESOLVED", confirmationCandidate: null });
      expect(review.employerMemoryReview?.candidates.map((c) => c.employerClusterId) ?? []).toEqual(index === 0 ? ["b"] : []);
    }
    expect(findBestMatch).not.toHaveBeenCalled();
    expect(saveNewClusterWithAssignment).not.toHaveBeenCalled();
    // With no memory panel left, rejection alone still suppresses M10.1.
    expect((await workflow.getVacancyReview(current.id)).employerMemoryReview).toBeUndefined();
    await expect(workflow.confirmVacancyEmployer({ canonicalVacancyId: current.id, candidateName: "ACME" })).rejects.toThrow("rejected");
    expect(await assignments.findEffectiveByObservationId("current")).toEqual(accepted);
    expect(await assignments.findByObservationId("current")).toHaveLength(3);
    if (db) {
      expect(db.prepare("SELECT superseded_at FROM observation_cluster_assignments WHERE id = ?").get(accepted.id)).toEqual({ superseded_at: null });
    }
  } finally { db?.close(); }
});
