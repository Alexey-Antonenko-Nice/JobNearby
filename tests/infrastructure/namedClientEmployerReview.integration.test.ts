import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteEmployerRecognitionPersistence } from "../../src/infrastructure/persistence/SqliteEmployerRecognitionPersistence.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import { processObservation } from "../../src/application/recognition/processObservation.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../src/application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { ExistingPipelineCanonicalVacancyAdapter } from "../../src/application/vacancies/ExistingPipelineCanonicalVacancyAdapter.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";

const date = new Date("2026-09-07T00:00:00Z");
const observation: SourceObservation = { id: "current", source: { sourceType: "JOB_BOARD", sourceName: "Indeed" }, observedAt: date, title: "Mécanicien Monteur d'Équipements Industriels H/F", displayedCompanyName: "ACTUA SAVERNE", description: "Recruteur: ACTUA Saverne\nACTUA recrute pour son client HEUFT France.", metadata: {} };
const anonymous = { id: "anonymous", status: "UNRESOLVED" as const, displayLabel: "Unknown employer", createdAt: date, updatedAt: date };
function repositories(db: ReturnType<typeof createDatabase>) {
  return { canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db), employerClusterRepository: new SqliteEmployerClusterRepository(db), employerClusterWriter: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db), recognitionPersistence: new SqliteEmployerRecognitionPersistence(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db) };
}
async function seed(db: ReturnType<typeof createDatabase>, withHistory = false) {
  const deps = repositories(db);
  await deps.sourceObservationRepository.save(observation);
  await deps.employerClusterRepository.save(anonymous);
  await deps.assignmentRepository.save(createObservationClusterAssignment({ sourceObservationId: "current", employerClusterId: "anonymous", status: "ACCEPTED", confidence: 1, algorithm: "new-employer-cluster", algorithmVersion: "1" }));
  const evidence = await new ExplicitTextVacancyEvidenceExtractor().extract(observation);
  expect(evidence.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ role: "CLIENT", value: "HEUFT France" }), expect.objectContaining({ role: "RECRUITER", value: "ACTUA Saverne" })]));
  const vacancy = await new ExistingPipelineCanonicalVacancyAdapter(new DeterministicCanonicalVacancyCanonicalizer()).canonicalize({ canonicalVacancyId: "actua-heuft", observations: [observation], extractedEvidence: [{ ...evidence, organizations: [...evidence.organizations, { role: "UNKNOWN", value: "ACTUA SAVERNE", provenance: { sourceObservationId: "current", extractionMethod: "DIRECT_FIELD", confidence: 1 } }] }], employerCluster: anonymous, derivation: { algorithm: "existing-pipeline-adapter", algorithmVersion: "1", derivedAt: date } });
  await deps.canonicalVacancyRepository.save(vacancy);
  if (withHistory) {
    await deps.sourceObservationRepository.save({ ...observation, id: "prior" });
    await deps.employerClusterRepository.save({ id: "heuft", status: "PROBABLY_RESOLVED", displayLabel: "HEUFT France", createdAt: date, updatedAt: date });
    await deps.assignmentRepository.save(createObservationClusterAssignment({ sourceObservationId: "prior", employerClusterId: "heuft", status: "USER_CONFIRMED", confidence: 1, algorithm: "user-employer-confirmation", algorithmVersion: "1" }));
  }
  return { deps, vacancy, workflow: createVacancyReviewWorkflow(deps) };
}
function sourceSnapshot(db: ReturnType<typeof createDatabase>) {
  return ["source_observations", "canonical_vacancies", "canonical_vacancy_organization_relationships", "canonical_vacancy_evidence_references"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

describe("ACTUA/HEUFT named-client SQLite integration", () => {
  it.each([false, true])("confirms atomically with existing HEUFT history = %s and preserves extracted source relationships", async (history) => {
    const db = createDatabase(":memory:");
    try {
      const { deps, vacancy, workflow } = await seed(db, history);
      const before = sourceSnapshot(db);
      const review = await workflow.getVacancyReview(vacancy.id);
      const c = review.employerReview?.candidates.find((c) => c.type === "NAMED_CLIENT");
      expect(c).toMatchObject({ name: "HEUFT France", employerClusterId: history ? "heuft" : null });
      expect(review.employer.confirmationCandidate).toBeNull();
      const input = { canonicalVacancyId: vacancy.id, type: "NAMED_CLIENT" as const, candidateId: c!.candidateId, decision: "CONFIRM" as const };
      await Promise.all([workflow.decideEmployerReview(input), workflow.decideEmployerReview(input)]);
      await workflow.decideEmployerReview(input);
      const current = await deps.assignmentRepository.findEffectiveByObservationId("current");
      expect(current?.status).toBe("USER_CONFIRMED");
      if (history) expect(current?.employerClusterId).toBe("heuft");
      expect(await deps.employerClusterRepository.findById(current!.employerClusterId)).toMatchObject({ displayLabel: "HEUFT France", status: "PROBABLY_RESOLVED" });
      expect(await deps.assignmentRepository.findByObservationId("current")).toHaveLength(2);
      expect(await deps.employerClusterRepository.findCandidates({})).toHaveLength(2);
      expect(sourceSnapshot(db)).toEqual(before);
      expect((await deps.canonicalVacancyRepository.findById(vacancy.id))?.organizationRelationships).toEqual(vacancy.organizationRelationships);
    } finally { db.close(); }
  });

  it("retains rejection after restart, does not promote the client on reprocessing, and creates no named cluster", async () => {
    const directory = mkdtempSync(join(tmpdir(), "m123-"));
    const path = join(directory, "review.sqlite");
    let db = createDatabase(path);
    try {
      const { deps, vacancy, workflow } = await seed(db);
      const source = sourceSnapshot(db);
      const current = await deps.assignmentRepository.findEffectiveByObservationId("current");
      const c = (await workflow.getVacancyReview(vacancy.id)).employerReview!.candidates.find((c) => c.type === "NAMED_CLIENT")!;
      const input = { canonicalVacancyId: vacancy.id, type: "NAMED_CLIENT" as const, candidateId: c.candidateId, decision: "REJECT" as const };
      await Promise.all([workflow.decideEmployerReview(input), workflow.decideEmployerReview(input)]);
      db.close(); db = createDatabase(path);
      const restarted = repositories(db); const restartedWorkflow = createVacancyReviewWorkflow(restarted);
      await restartedWorkflow.decideEmployerReview(input);
      expect((await restartedWorkflow.getVacancyReview(vacancy.id)).employerReview).toBeUndefined();
      expect(await restarted.assignmentRepository.findEffectiveByObservationId("current")).toEqual(current);
      expect(await restarted.employerClusterRepository.findCandidates({})).toHaveLength(1);
      expect(await restarted.assignmentRepository.findByObservationId("current")).toHaveLength(2);
      const result = await processObservation(observation, { clusterRepository: restarted.employerClusterRepository, assignmentRepository: restarted.assignmentRepository, recognitionPersistence: restarted.recognitionPersistence, matcher: { findBestMatch: async () => { throw new Error("unresolved membership must be preserved"); } }, evidenceExtractor: new ExplicitTextVacancyEvidenceExtractor(), policy: { automaticAssignmentThreshold: 0.9, reviewThreshold: 0.65 }, algorithm: "test", algorithmVersion: "1" });
      expect(result).toMatchObject({ employerCluster: anonymous });
      expect(sourceSnapshot(db)).toEqual(source);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("rolls back cluster creation when rejection wins a concurrent decision", async () => {
    const db = createDatabase(":memory:");
    try {
      const { deps, vacancy, workflow } = await seed(db);
      const candidate = (await workflow.getVacancyReview(vacancy.id)).employerReview!.candidates.find((c) => c.type === "NAMED_CLIENT")!;
      const input = { canonicalVacancyId: vacancy.id, type: "NAMED_CLIENT" as const, candidateId: candidate.candidateId };
      const results = await Promise.allSettled([workflow.decideEmployerReview({ ...input, decision: "REJECT" }), workflow.decideEmployerReview({ ...input, decision: "CONFIRM" })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await deps.employerClusterRepository.findCandidates({})).toHaveLength(1);
      expect(await deps.assignmentRepository.findByObservationId("current")).toHaveLength(2);
      expect((await deps.assignmentRepository.findEffectiveByObservationId("current"))?.employerClusterId).toBe("anonymous");
    } finally { db.close(); }
  });

  it("validates the generalized HTTP action and retains the memory endpoint", async () => {
    const db = createDatabase(":memory:");
    const { deps, vacancy, workflow } = await seed(db);
    const server = createBrowserCaptureServer({ ...workflow, captureAndProcessBrowserVacancy: async () => { throw new Error("unused"); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies/${vacancy.id}`;
    const post = (body: unknown, route = "employer-review") => fetch(`${url}/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      const review = (await (await fetch(`${url}/review`)).json()).review;
      const c = review.employerReview.candidates[0];
      for (const body of [{}, { type: "NAMED_CLIENT", candidateId: c.candidateId, decision: "INVALID" }, { type: "NAMED_CLIENT", candidateId: c.candidateId, decision: "CONFIRM", name: "ACTUA" }, { type: "INVALID", decision: "CONFIRM" }]) expect((await post(body)).status).toBe(400);
      expect((await post({ type: "NAMED_CLIENT", candidateId: "stale", decision: "CONFIRM" })).status).toBe(409);
      expect((await post({ candidateName: "ACTUA SAVERNE" }, "employer-confirmation")).status).toBe(409);
      expect((await post({ employerClusterId: "anonymous", decision: "CONFIRM" }, "employer-memory-review")).status).toBe(409);
      expect((await post({ type: "NAMED_CLIENT", candidateId: c.candidateId, decision: "CONFIRM" })).status).toBe(200);
      expect((await post({ type: "NAMED_CLIENT", candidateId: c.candidateId, decision: "CONFIRM" })).status).toBe(200);
      expect((await post({ type: "NAMED_CLIENT", candidateId: c.candidateId, decision: "REJECT" })).status).toBe(409);
      expect((await deps.assignmentRepository.findEffectiveByObservationId("current"))?.status).toBe("USER_CONFIRMED");
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); }
  });
});
