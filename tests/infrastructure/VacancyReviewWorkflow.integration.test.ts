import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createVacancyReviewWorkflow } from "../../src/application/user/createVacancyReviewWorkflow.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

const databasePath = join(process.cwd(), ".vacancy-review-workflow-test.sqlite");

describe("VacancyReviewWorkflow SQLite integration", () => {
  afterEach(() => { if (existsSync(databasePath)) unlinkSync(databasePath); });

  it("persists actions across restart while changing only private rows", async () => {
    let db = createDatabase(databasePath);
    const sources = new SqliteSourceObservationRepository(db);
    await sources.save(observation("heuft-a"));
    await sources.save(observation("heuft-b"));
    const clusters = new SqliteEmployerClusterRepository(db);
    await clusters.save({
      id: "cluster-heuft", status: "UNRESOLVED",
      createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"),
    });
    const original = heuftVacancy();
    const vacancy = {
      ...original,
      organizationRelationships: original.organizationRelationships.map((relationship) => ({
        ...relationship, employerClusterId: "cluster-heuft",
      })),
    };
    await new SqliteCanonicalVacancyRepository(db).save(vacancy);
    const beforePublic = publicSnapshot(db);
    let sequence = 0;
    let workflow = workflowFor(db, () => `event-${++sequence}`);
    await workflow.recordVacancyReviewAction({ canonicalVacancyId: vacancy.id, type: "REVIEWED" });
    const applied = await workflow.recordVacancyReviewAction({
      canonicalVacancyId: vacancy.id, type: "APPLIED", metadata: { channel: "JOB_BOARD" },
    });
    expect(applied.review.reviewSignals.alreadyAppliedToThisVacancy).toBe(true);
    expect(publicSnapshot(db)).toEqual(beforePublic);
    db.close();

    db = createDatabase(databasePath);
    workflow = workflowFor(db, () => `event-${++sequence}`);
    const restarted = await workflow.getVacancyReview(vacancy.id);
    expect(restarted.user.currentState).toBe("APPLIED");
    expect(restarted.reviewSignals.alreadyAppliedToThisVacancy).toBe(true);
    expect(db.prepare(`SELECT event_type FROM user_vacancy_interaction_events ORDER BY occurred_at, recorded_at, id`).all())
      .toEqual([{ event_type: "REVIEWED" }, { event_type: "APPLIED" }]);
    expect(publicSnapshot(db)).toEqual(beforePublic);
    db.close();
  });
});

type Db = ReturnType<typeof createDatabase>;
function workflowFor(db: Db, generateId: () => string) {
  return createVacancyReviewWorkflow({
    canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(db),
    sourceObservationRepository: new SqliteSourceObservationRepository(db),
    interactionRepository: new SqliteUserVacancyInteractionRepository(db),
    employerClusterRepository: new SqliteEmployerClusterRepository(db),
    employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
    now: () => new Date("2026-09-01T12:00:00Z"), generateId,
  });
}

function observation(id: string): SourceObservation {
  return {
    id, source: { sourceType: "JOB_BOARD", sourceName: "Example", externalId: id },
    observedAt: new Date("2026-09-01"), metadata: {},
  };
}

function publicSnapshot(db: Db): string {
  const tables = [
    "source_observations", "canonical_vacancies", "canonical_vacancy_source_observations",
    "canonical_vacancy_evidence_references", "canonical_vacancy_fields",
    "canonical_vacancy_organization_relationships", "employer_clusters",
    "observation_cluster_assignments",
  ];
  return JSON.stringify(Object.fromEntries(tables.map((table) => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ])));
}
