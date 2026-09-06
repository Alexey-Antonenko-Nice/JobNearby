import { describe, expect, it } from "vitest";

import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { EmployerCluster } from "../../src/domain/recognition/EmployerCluster.js";
import { InMemoryEmployerClusterRepository } from "../../src/infrastructure/persistence/InMemoryEmployerClusterRepository.js";
import { InMemoryEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/InMemoryEmployerRecognitionPersistence.js";
import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";

const date = () => new Date("2026-09-07T12:00:00Z");
const source = (id: string): SourceObservation => ({ id, source: { sourceType: "JOB_BOARD", sourceName: "Indeed" }, observedAt: date(), displayedCompanyName: "Air Products", metadata: {} });
const cluster: EmployerCluster = { id: "air-products-confirmed", status: "PROBABLY_RESOLVED", displayLabel: "Air Products", createdAt: date(), updatedAt: date() };

function setup() {
  const clusters = new InMemoryEmployerClusterRepository();
  const assignments = new InMemoryObservationClusterAssignmentRepository();
  return { clusters, assignments, persistence: new InMemoryEmployerRecognitionPersistence(clusters, assignments) };
}

describe("confirmed employer memory propagation", () => {
  it("reuses the prior confirmed cluster with an automatic ACCEPTED assignment", async () => {
    const deps = setup(); await deps.clusters.save(cluster);
    await deps.assignments.save(createObservationClusterAssignment({ sourceObservationId: "historical", employerClusterId: cluster.id, confidence: 1, status: "USER_CONFIRMED", algorithm: "user-employer-confirmation", algorithmVersion: "1.0.0" }, { now: date, generateId: () => "historical-confirmation" }));
    const result = await processObservation(source("later"), {
      clusterRepository: deps.clusters, assignmentRepository: deps.assignments, recognitionPersistence: deps.persistence,
      matcher: { findBestMatch: async () => { throw new Error("normal matcher should not run"); } },
      policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 }, algorithm: "matcher", algorithmVersion: "1",
      evidenceExtractor: { extract: async () => createExtractedVacancyEvidence({ sourceObservationId: "later", organizations: [{ value: "Air Products", role: "UNKNOWN", provenance: { sourceObservationId: "later", extractionMethod: "DIRECT_FIELD", confidence: 1 } }] }) },
      now: date, generateAssignmentId: () => "propagated",
    });
    expect(result).toMatchObject({ outcome: "MATCHED_EXISTING_CLUSTER", employerCluster: { id: cluster.id, status: "PROBABLY_RESOLVED" }, assignment: { status: "ACCEPTED", algorithm: "confirmed-employer-memory" } });
    expect((await deps.assignments.findEffectiveByObservationId("later"))).toMatchObject({ employerClusterId: cluster.id, status: "ACCEPTED" });
    expect((await deps.assignments.findByObservationId("historical"))[0]).toMatchObject({ status: "USER_CONFIRMED" });
  });

  it.each(["STAFFING_AGENCY", "RECRUITER", "CLIENT"] as const)("rejects propagation for %s contradiction", async (role) => {
    const deps = setup(); await deps.clusters.save(cluster);
    await deps.assignments.save(createObservationClusterAssignment({ sourceObservationId: "historical", employerClusterId: cluster.id, confidence: 1, status: "USER_CONFIRMED", algorithm: "user", algorithmVersion: "1" }, { now: date, generateId: () => "historical" }));
    const evidence = { sourceObservationId: "later", organizations: [{ value: "Air Products", role: "UNKNOWN" as const, provenance: { sourceObservationId: "later", extractionMethod: "DIRECT_FIELD" as const, confidence: 1 } }, { value: "Air Products", role, provenance: { sourceObservationId: "later", extractionMethod: "TEXT_EXTRACTION" as const, confidence: 0.98 } }] };
    const result = await processObservation(source("later"), { clusterRepository: deps.clusters, assignmentRepository: deps.assignments, recognitionPersistence: deps.persistence, matcher: { findBestMatch: async () => null }, policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 }, algorithm: "matcher", algorithmVersion: "1", evidenceExtractor: { extract: async () => createExtractedVacancyEvidence(evidence) }, generateClusterId: () => "new", generateAssignmentId: () => "new-assignment" });
    expect(result.outcome).toBe("CREATED_NEW_CLUSTER");
    expect(result.outcome).toBe("CREATED_NEW_CLUSTER");
    if (result.outcome === "CREATED_NEW_CLUSTER") expect(result.employerCluster.id).toBe("new");
  });
});
