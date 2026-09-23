import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/SqliteObservationClusterAssignmentRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { SqliteEmployerAliasEvidenceRepository } from "../../src/infrastructure/persistence/SqliteEmployerAliasEvidenceRepository.js";
import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import { DeterministicCanonicalVacancyCanonicalizer } from "../../src/application/vacancies/DeterministicCanonicalVacancyCanonicalizer.js";
import { normalizeOrganizationEvidenceName } from "../../src/domain/evidence/OrganizationEvidence.js";
import { createBrowserCaptureServer } from "../../src/infrastructure/http/createBrowserCaptureServer.js";
import type { UserVacancyInteractionType } from "../../src/domain/user/UserVacancyInteractionEvent.js";

const date = new Date("2026-09-01T00:00:00Z");
const derivation = { algorithm: "test", algorithmVersion: "1", derivedAt: date };
async function fixture() {
  const db = createDatabase(":memory:");
  const deps = {
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db),
    assignmentRepository: new SqliteObservationClusterAssignmentRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    aliasRepository: new SqliteEmployerAliasEvidenceRepository(db),
  };
  for (const [id, displayLabel] of [["heuft", "HEUFT"], ["other", "Other client"], ["unknown", "Unknown employer"]]) {
    await deps.employerClusterRepository.save({ id: id!, displayLabel: displayLabel!, status: id === "unknown" ? "UNRESOLVED" : "PROBABLY_RESOLVED", createdAt: date, updatedAt: date });
  }
  async function assignment(id: string, sourceObservationId: string, employerClusterId: string, status: "ACCEPTED" | "USER_CONFIRMED" | "REJECTED" | "PROPOSED" = "ACCEPTED") {
    const value = { id, sourceObservationId, employerClusterId, status, confidence: 1, algorithm: status === "USER_CONFIRMED" ? "user-employer-alias-review" : "confirmed-employer-memory", algorithmVersion: "1", evaluatedAt: date };
    await deps.assignmentRepository.save(value);
    return value;
  }
  async function vacancy(id: string, target: string, name: string, title: string, count = 1, human = false, lastTarget = target) {
    const ids = Array.from({ length: count }, (_, index) => `${id}-${index}`);
    for (const observationId of ids) {
      await deps.sourceObservationRepository.save({ id: observationId, source: { sourceType: "JOB_BOARD", sourceName: "Indeed" },
        observedAt: date, title, displayedCompanyName: name, metadata: {} });
      await assignment(`assignment-${observationId}`, observationId, observationId === ids.at(-1) ? lastTarget : target, human ? "USER_CONFIRMED" : "ACCEPTED");
    }
    const vacancy = new DeterministicCanonicalVacancyCanonicalizer().canonicalize({ id, sourceObservationIds: ids, evidenceReferences: [{ id: `${id}-evidence`, sourceObservationId: ids[0]!, kind: "ORGANIZATION_EVIDENCE" }],
      roleCandidates: [{ value: { title }, supportingEvidenceIds: [`${id}-evidence`] }], locationCandidates: [{ value: { rawText: "Strasbourg" }, supportingEvidenceIds: [`${id}-evidence`] }],
      organizationRelationships: [
        { role: "DISPLAYED_COMPANY", rawName: name, supportingEvidenceIds: [`${id}-evidence`], derivation },
        { role: "RECRUITER", rawName: "ACTUA Saverne", supportingEvidenceIds: [`${id}-evidence`], derivation },
        { role: "CLIENT", rawName: target === "heuft" ? "HEUFT France" : "Other client", supportingEvidenceIds: [`${id}-evidence`], derivation },
        // Deliberately stale public projection: private confirmation must win.
        { role: "EMPLOYER", employerClusterId: "unknown", supportingEvidenceIds: [`${id}-evidence`], derivation },
      ], derivation });
    await deps.canonicalVacancyRepository.save(vacancy);
  }
  await vacancy("current", "heuft", "ACTUA SAVERNE", "Current role", 2, true);
  await vacancy("one", "heuft", "HEUFT France", "Technicien itinérant", 3, true);
  await vacancy("two", "heuft", "HEUFT", "Mécanicien monteur");
  await vacancy("three", "heuft", "HEUFT France", "Mécanicien Monteur d'Équipements Industriels");
  await vacancy("other-client", "other", "ACTUA SAVERNE", "Other client's role");
  async function alias(id: string, name: string, sourceAssignmentId = "assignment-one-0", employerClusterId = "heuft") {
    await deps.aliasRepository.save({ id, aliasName: name, normalizedAliasName: normalizeOrganizationEvidenceName(name), employerClusterId,
      sourceType: "USER_CONFIRMED_ALIAS", sourceAssignmentId, createdAt: date, explanation: "Explicit user confirmation" });
  }
  await alias("a", "HEUFT France");
  await alias("b", "heuft france", "assignment-one-1");
  await alias("c", "heuft", "assignment-one-2");
  async function event(id: string, canonicalVacancyId: string, type: UserVacancyInteractionType, occurredAt: string) {
    await deps.interactionRepository.append({ id, canonicalVacancyId, type, occurredAt: new Date(occurredAt), recordedAt: date });
  }
  return { db, deps, assignment, alias, vacancy, event, workflow: createVacancyReviewWorkflow(deps) };
}

function snapshot(db: ReturnType<typeof createDatabase>) {
  return ["source_observations", "canonical_vacancies", "canonical_vacancy_fields", "canonical_vacancy_organization_relationships", "observation_cluster_assignments", "employer_alias_evidence", "user_vacancy_interaction_events"]
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

describe("M12.5 employer-centric history SQLite/API", () => {
  it("returns previous canonical roles through assignments, with aliases and private outcomes in one HTTP read", async () => {
    const f = await fixture();
    await f.event("applied", "one", "APPLIED", "2026-08-01");
    await f.event("applied-again", "one", "APPLIED", "2026-08-02");
    await f.event("interview", "one", "INTERVIEW", "2026-08-03");
    await f.event("rejected", "one", "REJECTED", "2026-08-04");
    await f.event("offer", "two", "OFFER", "2026-08-05");
    await f.event("current-applied", "current", "APPLIED", "2026-09-01");
    await f.event("other-applied", "other-client", "APPLIED", "2026-09-02");
    const before = snapshot(f.db);
    const server = createBrowserCaptureServer({ ...f.workflow, captureAndProcessBrowserVacancy: async () => { throw new Error("unused"); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/vacancies/current/review`);
      expect(response.status).toBe(200);
      const { review } = await response.json();
      expect(review.employerHistory.summary).toMatchObject({ vacancyCount: 3, everAppliedCount: 1, everInterviewedCount: 1, everOfferedCount: 1, everRejectedCount: 1, latestUserInteractionAt: "2026-08-05T00:00:00.000Z" });
      expect(review.employerHistory.knownNames).toEqual(["HEUFT", "HEUFT France"]);
      expect(review.employerHistory.vacancies.map((v: { canonicalVacancyId: string }) => v.canonicalVacancyId)).toEqual(["one", "three", "two"]);
      expect(review.employerHistory.vacancies).toEqual(expect.arrayContaining([
        expect.objectContaining({ canonicalVacancyId: "one", title: "Technicien itinérant", location: { rawText: "Strasbourg" }, sources: ["Indeed"], sourceObservationCount: 3, currentUserState: "REJECTED" }),
        expect.objectContaining({ title: "Mécanicien monteur", everOffered: true }),
        expect.objectContaining({ title: "Mécanicien Monteur d'Équipements Industriels", lastUserInteractionAt: null }),
      ]));
      expect(review.user.everApplied).toBe(true);
      expect(review.employer).toMatchObject({ employerClusterId: "heuft", status: "PROBABLY_RESOLVED", previousVacancyCount: 3, resolvedEmployerId: null });
      expect(review.organizations.recruiters).toContainEqual(expect.objectContaining({ rawName: "ACTUA Saverne" }));
      expect(review.employer.aliasEvidence).toBeUndefined();
      expect(snapshot(f.db)).toEqual(before);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); f.db.close(); }
  });

  it("excludes inactive aliases while preserving their audit evidence", async () => {
    const f = await fixture();
    try {
      await f.alias("inactive", "HEUFT Former Name");
      const original = (await f.deps.assignmentRepository.findById("assignment-one-0"))!;
      await f.deps.assignmentRepository.supersedeEffectiveAssignment(original.id, { ...original, id: "replacement" }, date);
      expect((await f.workflow.getVacancyReview("current")).employerHistory?.knownNames).toEqual(["HEUFT", "heuft france"]);
      expect(await f.deps.aliasRepository.findByClusterId("heuft")).toHaveLength(4);
    } finally { f.db.close(); }
  });

  it("rejects name-only, intermediary, superseded, and proposed memberships", async () => {
    const f = await fixture();
    try {
      // Another client's vacancy displays the same alias: names never establish history.
      await f.vacancy("same-name-other", "other", "HEUFT France", "Unrelated role");
      const original = (await f.deps.assignmentRepository.findById("assignment-three-0"))!;
      await f.deps.assignmentRepository.supersedeEffectiveAssignment(original.id, { ...original, id: "moved", employerClusterId: "other", status: "USER_CONFIRMED" }, date);
      await f.assignment("rejected", "other-client-0", "heuft", "REJECTED");
      await f.assignment("proposed", "same-name-other-0", "heuft", "PROPOSED");
      const history = (await f.workflow.getVacancyReview("current")).employerHistory!;
      expect(history.vacancies.map((v) => v.canonicalVacancyId)).toEqual(["one", "two"]);
      expect(history.summary.vacancyCount).toBe(2);
    } finally { f.db.close(); }
  });

  it("prefers human confirmation over newer automatic membership and counts a recapture once", async () => {
    const f = await fixture();
    try {
      await f.vacancy("mixed", "other", "HEUFT France", "Mixed membership", 2);
      const original = (await f.deps.assignmentRepository.findById("assignment-mixed-0"))!;
      await f.deps.assignmentRepository.supersedeEffectiveAssignment(original.id, { ...original, id: "human", employerClusterId: "heuft", status: "USER_CONFIRMED" }, date);
      const history = (await f.workflow.getVacancyReview("current")).employerHistory!;
      expect(history.vacancies.filter((v) => v.canonicalVacancyId === "mixed")).toHaveLength(1);
      const other = await f.deps.employerMemoryPublicDataSource.findByEmployerClusterId("other");
      expect(other.some((v) => v.canonicalVacancyId === "mixed")).toBe(false);
    } finally { f.db.close(); }
  });

  it("uses last source order for automatic memberships, consistently with current review", async () => {
    const f = await fixture();
    try {
      await f.vacancy("automatic", "heuft", "HEUFT France", "Automatic role", 2, false, "other");
      expect((await f.workflow.getVacancyReview("automatic")).employer.employerClusterId).toBe("other");
      expect((await f.deps.employerMemoryPublicDataSource.findByEmployerClusterId("heuft")).some((v) => v.canonicalVacancyId === "automatic")).toBe(false);
      expect((await f.deps.employerMemoryPublicDataSource.findByEmployerClusterId("other")).some((v) => v.canonicalVacancyId === "automatic")).toBe(true);
    } finally { f.db.close(); }
  });
});
