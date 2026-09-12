import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import type { EmployerAliasEvidence } from "../../src/domain/recognition/EmployerAliasEvidence.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";

const timestamp = new Date("2026-09-08T10:00:00.000Z");

describe("SqliteEmployerAliasEvidenceRepository", () => {
  it("keeps provenance, allows cross-cluster aliases, and makes retries idempotent", async () => {
    const db = createDatabase(":memory:");
    const aliases = new SqliteEmployerAliasEvidenceRepository(db);
    const assignments = new SqliteObservationClusterAssignmentRepository(db);
    const clusters = new SqliteEmployerClusterRepository(db);
    const observations = new SqliteSourceObservationRepository(db);
    for (const id of ["observation-a", "observation-b"]) {
      await observations.save({
        id,
        source: { sourceType: "MANUAL", sourceName: "alias-test" },
        observedAt: timestamp,
        metadata: {},
      });
    }
    for (const id of ["cluster-a", "cluster-b"]) {
      await clusters.save({ id, status: "PROBABLY_RESOLVED", displayLabel: "Canonical Employer", createdAt: timestamp, updatedAt: timestamp });
    }
    for (const [id, observationId, clusterId] of [["assignment-a", "observation-a", "cluster-a"], ["assignment-b", "observation-b", "cluster-b"]] as const) {
      await assignments.save(createObservationClusterAssignment({
        sourceObservationId: observationId,
        employerClusterId: clusterId,
        status: "USER_CONFIRMED",
        confidence: 1,
        algorithm: "user-review",
        algorithmVersion: "1.0.0",
      }, { generateId: () => id }));
    }
    const evidence = (id: string, clusterId: string, assignmentId: string): EmployerAliasEvidence => ({
      id,
      aliasName: "Canonical Employer SAS",
      normalizedAliasName: "canonical employer sas",
      employerClusterId: clusterId,
      sourceType: "USER_CONFIRMED_ALIAS",
      sourceAssignmentId: assignmentId,
      createdAt: timestamp,
      explanation: "User explicitly confirmed the employer name equivalence.",
    });

    await aliases.save(evidence("evidence-a", "cluster-a", "assignment-a"));
    await aliases.save(evidence("retry-with-new-id", "cluster-a", "assignment-a"));
    await aliases.save(evidence("evidence-b", "cluster-b", "assignment-b"));

    expect(await aliases.findActiveByNormalizedName("canonical employer sas")).toEqual([
      evidence("evidence-a", "cluster-a", "assignment-a"),
      evidence("evidence-b", "cluster-b", "assignment-b"),
    ]);
    expect(await aliases.findByClusterId("cluster-a")).toEqual([evidence("evidence-a", "cluster-a", "assignment-a")]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM employer_alias_evidence").get()).toEqual({ count: 2 });
    db.close();
  });

  it("preserves evidence history after its supporting confirmation is superseded", async () => {
    const db = createDatabase(":memory:");
    const aliases = new SqliteEmployerAliasEvidenceRepository(db);
    const assignments = new SqliteObservationClusterAssignmentRepository(db);
    const clusters = new SqliteEmployerClusterRepository(db);
    const observations = new SqliteSourceObservationRepository(db);
    await observations.save({ id: "observation", source: { sourceType: "MANUAL", sourceName: "alias-test" }, observedAt: timestamp, metadata: {} });
    await clusters.save({ id: "cluster", status: "PROBABLY_RESOLVED", displayLabel: "Canonical Employer", createdAt: timestamp, updatedAt: timestamp });
    const original = createObservationClusterAssignment({ sourceObservationId: "observation", employerClusterId: "cluster", status: "USER_CONFIRMED", confidence: 1, algorithm: "user-review", algorithmVersion: "1.0.0" }, { generateId: () => "assignment" });
    await assignments.save(original);
    const alias: EmployerAliasEvidence = { id: "evidence", aliasName: "Canonical Employer SAS", normalizedAliasName: "canonical employer sas", employerClusterId: "cluster", sourceType: "USER_CONFIRMED_ALIAS", sourceAssignmentId: original.id, createdAt: timestamp, explanation: "User explicitly confirmed the employer name equivalence." };
    await aliases.save(alias);
    const replacement = createObservationClusterAssignment({ sourceObservationId: "observation", employerClusterId: "cluster", status: "USER_CONFIRMED", confidence: 1, algorithm: "later-review", algorithmVersion: "1.0.0" }, { generateId: () => "replacement" });
    await assignments.supersedeEffectiveAssignment(original.id, replacement, new Date("2026-09-08T11:00:00.000Z"));

    expect(await aliases.findActiveByNormalizedName(alias.normalizedAliasName)).toEqual([]);
    expect(await aliases.findByClusterId("cluster")).toEqual([alias]);
    db.close();
  });

  it("rejects empty aliases and mismatched supporting assignments", async () => {
    const db = createDatabase(":memory:");
    const aliases = new SqliteEmployerAliasEvidenceRepository(db);
    const assignments = new SqliteObservationClusterAssignmentRepository(db);
    const clusters = new SqliteEmployerClusterRepository(db);
    const observations = new SqliteSourceObservationRepository(db);
    await observations.save({ id: "observation", source: { sourceType: "MANUAL", sourceName: "alias-test" }, observedAt: timestamp, metadata: {} });
    await clusters.save({ id: "cluster", status: "PROBABLY_RESOLVED", createdAt: timestamp, updatedAt: timestamp });
    await assignments.save(createObservationClusterAssignment({ sourceObservationId: "observation", employerClusterId: "cluster", status: "ACCEPTED", confidence: 1, algorithm: "matcher", algorithmVersion: "1.0.0" }, { generateId: () => "assignment" }));
    const invalid: EmployerAliasEvidence = { id: "invalid", aliasName: "", normalizedAliasName: "", employerClusterId: "cluster", sourceType: "USER_CONFIRMED_ALIAS", sourceAssignmentId: "assignment", createdAt: timestamp, explanation: "invalid" };
    await expect(aliases.save(invalid)).rejects.toThrow("Invalid employer alias evidence.");
    db.close();
  });
});
