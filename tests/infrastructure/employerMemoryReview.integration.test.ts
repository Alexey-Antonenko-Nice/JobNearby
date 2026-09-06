import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { createObservationClusterAssignment } from "../../src/application/recognition/createObservationClusterAssignment.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

function workflow(db: ReturnType<typeof createDatabase>) {
  return createVacancyReviewWorkflow({ canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db), employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db), interactionRepository: new SqliteUserVacancyInteractionRepository(db) });
}
async function seed(db: ReturnType<typeof createDatabase>) {
  const base = heuftVacancy();
  const current = { ...base, sourceObservationIds: ["current"], evidenceReferences: base.evidenceReferences.map((e) => ({ ...e, sourceObservationId: "current" })), organizationRelationships: [{ role: "DISPLAYED_COMPANY" as const, rawName: "ACME", supportingEvidenceIds: base.organizationRelationships[0]!.supportingEvidenceIds, derivation: base.derivation }] };
  for (const id of ["current", "prior-a", "prior-b"]) await new SqliteSourceObservationRepository(db).save({ id, source: { sourceType: "JOB_BOARD", sourceName: "test" }, observedAt: new Date(), metadata: {} });
  await new SqliteCanonicalVacancyRepository(db).save(current);
  for (const id of ["a", "b"]) {
    await new SqliteEmployerClusterRepository(db).save({ id, status: "PROBABLY_RESOLVED", displayLabel: "ACME", createdAt: new Date(), updatedAt: new Date() });
    await new SqliteObservationClusterAssignmentRepository(db).save(createObservationClusterAssignment({ sourceObservationId: `prior-${id}`, employerClusterId: id, status: "USER_CONFIRMED", confidence: 1, algorithm: "user", algorithmVersion: "1" }));
  }
  return current.id;
}

describe("employer memory review persistence and HTTP", () => {
  it("retains rejection across database restart and concurrent retries", async () => {
    const directory = mkdtempSync(join(tmpdir(), "m122-"));
    const path = join(directory, "test.sqlite");
    let db = createDatabase(path);
    try {
      const id = await seed(db);
      const input = { canonicalVacancyId: id, employerClusterId: "a", decision: "REJECT" as const };
      const first = workflow(db);
      await Promise.all([first.decideEmployerMemoryReview(input), first.decideEmployerMemoryReview(input)]);
      db.close(); db = createDatabase(path);
      const restarted = workflow(db);
      expect((await restarted.getVacancyReview(id)).employerMemoryReview?.candidates.map((c) => c.employerClusterId)).toEqual(["b"]);
      await restarted.decideEmployerMemoryReview(input);
      expect(db.prepare("SELECT status FROM observation_cluster_assignments WHERE source_observation_id = 'current'").all()).toEqual([{ status: "REJECTED" }]);
      const confirm = { ...input, employerClusterId: "b", decision: "CONFIRM" as const };
      await Promise.all([restarted.decideEmployerMemoryReview(confirm), restarted.decideEmployerMemoryReview(confirm)]);
      expect(await new SqliteObservationClusterAssignmentRepository(db).findEffectiveByObservationId("current")).toMatchObject({ status: "USER_CONFIRMED", employerClusterId: "b" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 2 });
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("serves candidates, validates payload and membership, and records explicit confirmation", async () => {
    const db = createDatabase(":memory:");
    const id = await seed(db);
    const review = workflow(db);
    const server = createBrowserCaptureServer({ captureAndProcessBrowserVacancy: async () => { throw new Error("unused"); }, getVacancyReview: review.getVacancyReview, decideEmployerMemoryReview: review.decideEmployerMemoryReview });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies/${id}`;
    const post = (body: object) => fetch(`${url}/employer-memory-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      expect((await (await fetch(`${url}/review`)).json()).review.employerMemoryReview.candidates).toHaveLength(2);
      expect((await post({ employerClusterId: "a", decision: "INVALID" })).status).toBe(400);
      expect((await post({ employerClusterId: "a", decision: "CONFIRM", unexpected: true })).status).toBe(400);
      expect((await post({ employerClusterId: "non-candidate", decision: "CONFIRM" })).status).toBe(409);
      const confirmed = await post({ employerClusterId: "b", decision: "CONFIRM" });
      expect(confirmed.status).toBe(200);
      expect((await confirmed.json()).review.employer.employerClusterId).toBe("b");
      expect((await post({ employerClusterId: "b", decision: "CONFIRM" })).status).toBe(200);
      expect((await post({ employerClusterId: "a", decision: "CONFIRM" })).status).toBe(409);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); }
  });
});
