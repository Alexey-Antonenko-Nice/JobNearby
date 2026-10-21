import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { resolveCanonicalField } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";

const payload = (salary: string, capturedAt: string) => ({
  pageUrl: "https://www.hellowork.com/fr-fr/emplois/84500085.html", pageTitle: "HelloWork",
  visibleText: `Technicien de Maintenance H/F\n67 - Strasbourg\nCDI\n${salary}`, capturedAt,
  html: `<div id="offer-panel" role="tabpanel"><h1 id="main-content"><span data-cy="jobTitle">Technicien de Maintenance H/F</span></h1><p>67 - Strasbourg</p><p>CDI</p><p>${salary}</p></div>`,
});
async function fixture() {
  const db = createDatabase(":memory:");
  const runtime = createCaptureProcessingRuntime(db);
  const deps = {
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db), sourceObservationRepository: new SqliteSourceObservationRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db), assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db), employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
  };
  const firstPayload = payload("13 € / heure", "2026-10-19T10:00:00Z");
  const newerPayload = payload("32 000 - 36 000 € / an", "2026-10-21T10:00:00Z");
  const first = await runtime.captureAndProcessBrowserVacancy(firstPayload);
  const newer = await runtime.captureAndProcessBrowserVacancy(newerPayload);
  if (first.processing.status !== "PROCESSED" || newer.processing.status !== "PROCESSED") throw new Error("Processing failed");
  return { db, runtime, deps, first, newer, firstPayload, newerPayload, canonicalId: first.processing.canonicalVacancyId,
    workflow: createVacancyReviewWorkflow(deps), snapshot: () => JSON.stringify(["source_observations", "canonical_vacancies", "canonical_vacancy_fields", "capture_occurrences", "employer_clusters", "observation_cluster_assignments"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())) };
}

describe("temporal compensation persistence and read model", () => {
  it("projects a clean HelloWork hourly-to-annual change while preserving employer continuity and source history", async () => {
    const f = await fixture();
    try {
      const current = (await f.deps.canonicalVacancyRepository.findById(f.canonicalId))!;
      expect(f.newer.processing).toMatchObject({ canonicalVacancyId: f.canonicalId, observationAdded: true });
      expect(current.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 32000, maximum: 36000, period: "YEAR" } });
      expect(current.canonicalizationStatus).toBe("USABLE");
      const firstAssignment = (await f.deps.assignmentRepository.findEffectiveByObservationId(f.first.capture.observationId))!;
      const nextAssignment = await f.deps.assignmentRepository.findEffectiveByObservationId(f.newer.capture.observationId);
      expect(nextAssignment).toMatchObject({ employerClusterId: firstAssignment.employerClusterId, algorithm: "canonical-vacancy-employer-continuity", status: "ACCEPTED" });
      const before = f.snapshot();
      for (let index = 0; index < 2; index++) {
        const review = await f.workflow.getVacancyReview(f.canonicalId);
        expect(review.vacancy).toMatchObject({ canonicalizationStatus: "USABLE", sourceObservationCount: 2, compensation: { minimum: 32000, maximum: 36000, period: "YEAR" } });
        expect(review.vacancy.compensationHistory).toEqual([expect.objectContaining({ sourceObservationId: f.first.capture.observationId,
          observedAt: new Date("2026-10-19T10:00:00Z"), values: [expect.objectContaining({ minimum: 13, period: "HOUR" })] })]);
        expect(JSON.parse(JSON.stringify(review)).vacancy.compensationHistory[0].observedAt).toBe("2026-10-19T10:00:00.000Z");
        expect(review.vacancyContext.seenBefore).toBe(true);
      }
      expect(f.snapshot()).toBe(before);
      const old = (await f.deps.sourceObservationRepository.findById(f.first.capture.observationId))!;
      expect(old.rawContent).toContain("13 € / heure");
      expect(current.evidenceReferences.some((reference) => reference.sourceObservationId === old.id && reference.kind === "VACANCY_COMPENSATION_EVIDENCE")).toBe(true);
    } finally { f.db.close(); }
  });

  it("does not turn exact recapture of old content into a new temporal salary change", async () => {
    const f = await fixture();
    try {
      const sources = f.db.prepare("SELECT * FROM source_observations ORDER BY id").all();
      const assignments = f.db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all();
      const repeated = await f.runtime.captureAndProcessBrowserVacancy({ ...f.firstPayload, capturedAt: "2026-10-23T10:00:00Z" });
      expect(repeated.capture.observationId).toBe(f.first.capture.observationId);
      expect(repeated.processing).toMatchObject({ canonicalVacancyId: f.canonicalId, observationAdded: false });
      expect(await f.deps.sourceObservationRepository.countCaptureOccurrences([f.first.capture.observationId])).toBe(2);
      expect((await f.deps.canonicalVacancyRepository.findById(f.canonicalId))?.compensation.value?.period).toBe("YEAR");
      expect((await f.workflow.getVacancyReview(f.canonicalId)).vacancy.compensationHistory).toHaveLength(1);
      expect(f.db.prepare("SELECT * FROM source_observations ORDER BY id").all()).toEqual(sources);
      expect(f.db.prepare("SELECT * FROM observation_cluster_assignments ORDER BY id").all()).toEqual(assignments);
      expect(f.db.prepare("SELECT COUNT(*) AS count FROM employer_clusters").get()).toEqual({ count: 1 });
    } finally { f.db.close(); }
  });

  it("reopening a stale compensation projection applies the policy read-only; recapture persists it", async () => {
    const f = await fixture();
    try {
      const vacancy = (await f.deps.canonicalVacancyRepository.findById(f.canonicalId))!;
      const oldRef = vacancy.evidenceReferences.find((reference) => reference.sourceObservationId === f.first.capture.observationId && reference.kind === "VACANCY_COMPENSATION_EVIDENCE")!.id;
      const newRef = vacancy.compensation.supportingEvidenceIds[0]!;
      const staleCompensation = resolveCanonicalField([
        { value: { minimum: 13, currency: "EUR", period: "HOUR" as const }, supportingEvidenceIds: [oldRef] },
        { value: { minimum: 32000, maximum: 36000, currency: "EUR", period: "YEAR" as const }, supportingEvidenceIds: [newRef] },
      ], new Set(vacancy.evidenceReferences.map((reference) => reference.id)), vacancy.derivation);
      await f.deps.canonicalVacancyRepository.save({ ...vacancy, compensation: staleCompensation, canonicalizationStatus: "CONFLICTED" });
      const before = f.snapshot();
      expect((await f.workflow.getVacancyReview(f.canonicalId)).vacancy).toMatchObject({ canonicalizationStatus: "USABLE", compensation: { period: "YEAR" } });
      expect(f.snapshot()).toBe(before);
      expect((await f.deps.canonicalVacancyRepository.findById(f.canonicalId))?.compensation.status).toBe("CONFLICTED");
      await f.runtime.captureAndProcessBrowserVacancy({ ...f.newerPayload, capturedAt: "2026-10-24T10:00:00Z" });
      expect((await f.deps.canonicalVacancyRepository.findById(f.canonicalId))?.canonicalizationStatus).toBe("USABLE");
    } finally { f.db.close(); }
  });
});
