import { describe, expect, it } from "vitest";

import { getEmployerMemoryView } from "../../src/application/user/getEmployerMemoryView.js";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../../src/infrastructure/persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";

describe("SqliteEmployerMemoryPublicDataSource", () => {
  it("uses only explicit employer-cluster relationships and reads without mutation", async () => {
    const db = createDatabase(":memory:");
    insertCluster(db, "target", "PROBABLY_RESOLVED");
    insertCluster(db, "other", "UNRESOLVED");
    insertVacancy(db, "member", "USABLE");
    insertVacancy(db, "recruiter-only", "PARTIAL");
    insertVacancy(db, "name-only", "PARTIAL");
    insertObservation(db, "old", "2026-09-01T00:00:00Z");
    insertObservation(db, "new", "2026-09-03T00:00:00Z");
    addObservation(db, "member", "old", 0);
    addObservation(db, "member", "new", 1);
    addField(db, "member", "role", "RESOLVED", { title: "Maintenance Engineer" });
    addField(db, "member", "location", "RESOLVED", { rawText: "Strasbourg" });
    addRelationship(db, "member", 0, "EMPLOYER", null, "target");
    addRelationship(db, "member", 1, "RECRUITER", "Akkodis France", null);
    addRelationship(db, "member", 2, "CONSULTANCY", "Akkodis France", null);
    addRelationship(db, "recruiter-only", 0, "RECRUITER", "Target recruiter", "target");
    addRelationship(db, "name-only", 0, "EMPLOYER", "Target", null);

    const interactions = new SqliteUserVacancyInteractionRepository(db);
    await interactions.append({
      id: "applied", canonicalVacancyId: "member", type: "APPLIED",
      occurredAt: new Date("2026-09-02T00:00:00Z"), recordedAt: new Date("2026-09-02T00:00:00Z"),
    });
    const before = snapshot(db);
    const view = await getEmployerMemoryView("target", {
      employerClusterRepository: new SqliteEmployerClusterRepository(db),
      publicDataSource: new SqliteEmployerMemoryPublicDataSource(db),
      interactionRepository: interactions,
    });

    expect(view.employerCluster.status).toBe("PROBABLY_RESOLVED");
    expect(view.vacancies).toEqual([expect.objectContaining({
      canonicalVacancyId: "member", title: "Maintenance Engineer",
      location: { rawText: "Strasbourg" }, sourceObservationCount: 2,
      latestObservedAt: new Date("2026-09-03T00:00:00Z"), currentUserState: "APPLIED",
      recruiterConsultancyRelationships: [
        { rawName: "Akkodis France", role: "RECRUITER" },
        { rawName: "Akkodis France", role: "CONSULTANCY" },
      ],
    })]);
    expect(view.vacancies.map(({ canonicalVacancyId }) => canonicalVacancyId))
      .not.toContain("recruiter-only");
    expect(view.vacancies.map(({ canonicalVacancyId }) => canonicalVacancyId))
      .not.toContain("name-only");
    expect(snapshot(db)).toEqual(before);
    db.close();
  });
});

type Db = ReturnType<typeof createDatabase>;
const timestamp = "2026-09-01T00:00:00Z";

function insertCluster(db: Db, id: string, status: string): void {
  db.prepare(`INSERT INTO employer_clusters (id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(id, status, timestamp, timestamp);
}

function insertVacancy(db: Db, id: string, status: string): void {
  db.prepare(`INSERT INTO canonical_vacancies (
    id, canonicalization_status, derivation_algorithm, derivation_algorithm_version,
    derived_at, created_at, updated_at
  ) VALUES (?, ?, 'test', '1', ?, ?, ?)`).run(id, status, timestamp, timestamp, timestamp);
}

function insertObservation(db: Db, id: string, observedAt: string): void {
  db.prepare(`INSERT INTO source_observations (
    id, source_type, source_name, observed_at, metadata_json
  ) VALUES (?, 'JOB_BOARD', 'Example', ?, '{}')`).run(id, observedAt);
}

function addObservation(db: Db, vacancyId: string, observationId: string, order: number): void {
  db.prepare(`INSERT INTO canonical_vacancy_source_observations (
    canonical_vacancy_id, source_observation_id, observation_order
  ) VALUES (?, ?, ?)`).run(vacancyId, observationId, order);
}

function addField(db: Db, vacancyId: string, name: string, status: string, value: unknown): void {
  db.prepare(`INSERT INTO canonical_vacancy_fields (
    canonical_vacancy_id, field_name, status, value_json,
    derivation_algorithm, derivation_algorithm_version, derived_at
  ) VALUES (?, ?, ?, ?, 'test', '1', ?)`).run(vacancyId, name, status, JSON.stringify(value), timestamp);
}

function addRelationship(
  db: Db, vacancyId: string, order: number, role: string,
  rawName: string | null, clusterId: string | null,
): void {
  db.prepare(`INSERT INTO canonical_vacancy_organization_relationships (
    canonical_vacancy_id, relationship_order, employer_cluster_id, raw_name, role,
    derivation_algorithm, derivation_algorithm_version, derived_at
  ) VALUES (?, ?, ?, ?, ?, 'test', '1', ?)`).run(
    vacancyId, order, clusterId, rawName, role, timestamp,
  );
}

function snapshot(db: Db): string {
  return JSON.stringify({
    clusters: db.prepare("SELECT * FROM employer_clusters ORDER BY id").all(),
    vacancies: db.prepare("SELECT * FROM canonical_vacancies ORDER BY id").all(),
    relationships: db.prepare("SELECT * FROM canonical_vacancy_organization_relationships ORDER BY canonical_vacancy_id, relationship_order").all(),
    observations: db.prepare("SELECT * FROM source_observations ORDER BY id").all(),
    interactions: db.prepare("SELECT * FROM user_vacancy_interaction_events ORDER BY id").all(),
  });
}
