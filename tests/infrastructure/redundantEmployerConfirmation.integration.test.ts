import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { isEmployerConfirmationRedundant } from "../../src/application/user/employerConfirmation.js";
import { createAliasEvidence } from "../../src/application/recognition/createEmployerAliasEvidence.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";
import { SqliteEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/SqliteEmployerRecognitionPersistence.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";

const date = new Date("2026-10-20T10:00:00Z");
async function fixture(label = "Elite Robots", name = label, alias = false) {
  const db = createDatabase(":memory:");
  const clusters = new SqliteEmployerClusterRepository(db);
  const assignments = new SqliteObservationClusterAssignmentRepository(db);
  const deps = {
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    employerClusterRepository: clusters, employerClusterWriter: clusters,
    assignmentRepository: assignments,
    aliasRepository: new SqliteEmployerAliasEvidenceRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
  };
  const workflow = createVacancyReviewWorkflow(deps);
  for (const [id, display] of [["prior", label], ["current", name]] as const) {
    const observation = { id, displayedCompanyName: display!, source: { sourceType: "JOB_BOARD" as const, sourceName: "test" }, observedAt: date, metadata: {} };
    await deps.sourceObservationRepository.save(observation);
    await deps.canonicalVacancyRepository.save(new DeterministicCanonicalVacancyCanonicalizer().canonicalize({
      id: id!, sourceObservationIds: [id!], evidenceReferences: [{ id: `org-${id}`, sourceObservationId: id!, kind: "ORGANIZATION_EVIDENCE" }],
      organizationRelationships: [{ role: "DISPLAYED_COMPANY", rawName: display!, supportingEvidenceIds: [`org-${id}`], derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: date } }],
      derivation: { algorithm: "test", algorithmVersion: "1", derivedAt: date },
    }));
  }
  expect((await workflow.getVacancyReview("prior")).employer.confirmationCandidate).toBe(label);
  await workflow.confirmVacancyEmployer({ canonicalVacancyId: "prior", candidateName: label });
  const human = (await assignments.findEffectiveByObservationId("prior"))!;
  expect(human.status).toBe("USER_CONFIRMED");
  if (alias) await deps.aliasRepository.save(createAliasEvidence(name, label, human)!);
  const observation = (await deps.sourceObservationRepository.findById("current"))!;
  await processObservation(observation, {
    clusterRepository: clusters, assignmentRepository: assignments,
    recognitionPersistence: new SqliteEmployerRecognitionPersistence(db), aliasRepository: deps.aliasRepository,
    policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 }, algorithm: "test", algorithmVersion: "1",
    matcher: { findBestMatch: async () => null },
    evidenceExtractor: { extract: async () => createExtractedVacancyEvidence({ sourceObservationId: "current", organizations: [{ value: name, role: "DISPLAYED_COMPANY", provenance: { sourceObservationId: "current", extractionMethod: "DIRECT_FIELD", confidence: 1 } }] }) },
  });
  const projected = (await deps.canonicalVacancyRepository.findById("current"))!;
  const membership = (await assignments.findEffectiveByObservationId("current"))!;
  const current = { ...projected, organizationRelationships: [...projected.organizationRelationships,
    { role: "EMPLOYER" as const, employerClusterId: membership.employerClusterId, supportingEvidenceIds: ["org-current"], derivation: projected.derivation }] };
  await deps.canonicalVacancyRepository.save(current);
  const snapshot = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((row) => { const table = (row as { name: string }).name; return [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]; });
  return { db, deps, workflow, human, current, snapshot };
}

describe("redundant direct employer confirmation", () => {
  it.each([
    ["Elite Robots", "Elite Robots", false],
    ["Elite Robots", "  ELITE  ROBOTS  ", false],
    ["Air Products", "Air Products S.A.S.", true],
  ] as const)("keeps %s history and rejects stale POST after propagation to %s", async (label, name, alias) => {
    const f = await fixture(label, name, alias);
    const server = createBrowserCaptureServer({ ...f.workflow, captureAndProcessBrowserVacancy: async () => { throw new Error("unused"); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const before = f.snapshot();
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies/current`;
      for (let index = 0; index < 2; index++) {
        const response = await fetch(`${url}/review`);
        expect(response.status).toBe(200);
        const { review } = await response.json();
        expect(review.employer).toMatchObject({ employerClusterId: f.human.employerClusterId, status: "PROBABLY_RESOLVED", knownBefore: true, previousVacancyCount: 1, confirmationCandidate: null });
        expect(review.employerHistory.employerCluster.displayLabel).toBe(label);
        expect(review.employerHistory.vacancies.map((v: { canonicalVacancyId: string }) => v.canonicalVacancyId)).toEqual(["prior"]);
        expect(review.employerReview).toBeUndefined();
        expect(review.employerMemoryReview).toBeUndefined();
      }
      const response = await fetch(`${url}/employer-confirmation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateName: name.trim() }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "Employer candidate is no longer eligible for confirmation." });
      expect(await f.deps.assignmentRepository.findEffectiveByObservationId("current")).toMatchObject({ status: "ACCEPTED", algorithm: "confirmed-employer-memory", employerClusterId: f.human.employerClusterId });
      expect(await f.deps.assignmentRepository.findByObservationId("current")).toHaveLength(1);
      expect((await f.workflow.getVacancyReview("prior")).employer.confirmationCandidate).toBeNull();
      expect(f.snapshot()).toEqual(before);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.db.close(); }
  });

  it("does not treat a machine-only same-name assignment as prior human proof", async () => {
    const f = await fixture();
    try {
      // Lose the historical human proof while keeping the current ACCEPTED membership.
      f.db.prepare("UPDATE observation_cluster_assignments SET status = 'ACCEPTED', algorithm = 'recognition' WHERE id = ?").run(f.human.id);
      expect((await f.workflow.getVacancyReview("current")).employer.confirmationCandidate).toBe("Elite Robots");
      await f.workflow.confirmVacancyEmployer({ canonicalVacancyId: "current", candidateName: "Elite Robots" });
      expect(await f.deps.assignmentRepository.findEffectiveByObservationId("current")).toMatchObject({ status: "USER_CONFIRMED" });
    } finally { f.db.close(); }
  });

  it("does not suppress a different displayed candidate merely because an effective known assignment exists", async () => {
    const f = await fixture("Company A", "Company B");
    try {
      const current = (await f.deps.assignmentRepository.findEffectiveByObservationId("current"))!;
      f.db.prepare("UPDATE observation_cluster_assignments SET employer_cluster_id = ?, algorithm = 'confirmed-employer-memory' WHERE id = ?").run(f.human.employerClusterId, current.id);
      // Keep the projected employer anchor consistent with the seeded assignment.
      const projected = { ...f.current, organizationRelationships: f.current.organizationRelationships.map((r) =>
        r.role === "EMPLOYER" ? { ...r, employerClusterId: f.human.employerClusterId } : r) };
      await f.deps.canonicalVacancyRepository.save(projected);
      expect(await isEmployerConfirmationRedundant(projected, "Company B", f.deps)).toBe(false);
      expect((await f.workflow.getVacancyReview("current")).employer.confirmationCandidate).toBe("Company B");
      await expect(f.workflow.confirmVacancyEmployer({ canonicalVacancyId: "current", candidateName: "Company B" })).rejects.toThrow(/current employer identity/u);
    } finally { f.db.close(); }
  });

  it("does not suppress based on an arbitrary winner among matching confirmed clusters", async () => {
    const f = await fixture();
    try {
      await f.deps.employerClusterRepository.save({ id: "second", status: "PROBABLY_RESOLVED", displayLabel: "Elite Robots", createdAt: date, updatedAt: date });
      await f.deps.sourceObservationRepository.save({ id: "second-prior", source: { sourceType: "JOB_BOARD", sourceName: "test" }, observedAt: date, metadata: {} });
      await f.deps.assignmentRepository.save({ ...f.human, id: "second-proof", sourceObservationId: "second-prior", employerClusterId: "second" });
      expect(await isEmployerConfirmationRedundant(f.current, "Elite Robots", f.deps)).toBe(false);
      expect((await f.workflow.getVacancyReview("current")).employer.confirmationCandidate).toBe("Elite Robots");
    } finally { f.db.close(); }
  });

  it("preserves a pending recognition proposal", async () => {
    const f = await fixture();
    try {
      await f.deps.assignmentRepository.save({ ...f.human, id: "proposal", sourceObservationId: "current", status: "PROPOSED" });
      expect(await isEmployerConfirmationRedundant(f.current, "Elite Robots", f.deps)).toBe(false);
      expect(await f.deps.assignmentRepository.findCurrentProposalByObservationId("current")).toMatchObject({ id: "proposal" });
    } finally { f.db.close(); }
  });

  it("does not use inactive aliases as same-employer proof", async () => {
    const f = await fixture("Air Products", "Air Products S.A.S.", true);
    try {
      await f.deps.assignmentRepository.supersedeEffectiveAssignment(f.human.id, { ...f.human, id: "new-proof" }, date);
      expect(await isEmployerConfirmationRedundant(f.current, "Air Products S.A.S.", f.deps)).toBe(false);
      expect((await f.workflow.getVacancyReview("current")).employer.confirmationCandidate).toBe("Air Products S.A.S.");
    } finally { f.db.close(); }
  });
});
