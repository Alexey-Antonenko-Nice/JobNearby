import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

describe("database migrations", () => {
  it("creates the source observations schema", () => {
    const db = createDatabase(":memory:");

    const migration = db
      .prepare(`
        SELECT version, name
        FROM schema_migrations
        WHERE version = 1
      `)
      .get() as
      | { version: number; name: string }
      | undefined;

    expect(migration).toEqual({
      version: 1,
      name: "create_source_observations",
    });

    const table = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'source_observations'
      `)
      .get() as
      | { name: string }
      | undefined;

    expect(table?.name).toBe("source_observations");

    db.close();
  });

  it("can run migrations more than once safely", () => {
    const db = createDatabase(":memory:");

    expect(() => migrateDatabase(db)).not.toThrow();

    const rows = db
      .prepare(`
        SELECT version
        FROM schema_migrations
      `)
      .all();

    expect(rows).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ]);

    db.close();
  });

  it("creates canonical identity claims and single-membership uniqueness", () => {
    const db = createDatabase(":memory:");
    expect(db.prepare(`
      SELECT version, name FROM schema_migrations WHERE version = 4
    `).get()).toEqual({
      version: 4,
      name: "create_canonical_vacancy_identity_claims",
    });
    const names = new Set(
      (db.prepare(`
        SELECT name FROM sqlite_master
        WHERE name LIKE 'canonical_vacancy_%claim%'
           OR name = 'idx_canonical_vacancy_single_observation_membership'
      `).all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect(names).toEqual(expect.objectContaining(new Set([
      "canonical_vacancy_observation_claims",
      "canonical_vacancy_exact_identity_claims",
      "idx_canonical_vacancy_single_observation_membership",
    ])));
    db.close();
  });

  it("creates the structured canonical vacancy schema and lookup indexes", () => {
    const db = createDatabase(":memory:");
    const migration = db.prepare(`
      SELECT version, name FROM schema_migrations WHERE version = 2
    `).get();
    expect(migration).toEqual({
      version: 2,
      name: "create_canonical_vacancies",
    });

    const objects = db.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'canonical_vacanc%'
         OR name LIKE 'idx_canonical_vacancy%'
    `).all() as Array<{ type: string; name: string }>;
    const names = new Set(objects.map(({ name }) => name));
    for (const expectedName of [
      "canonical_vacancies",
      "canonical_vacancy_fields",
      "canonical_vacancy_field_alternatives",
      "canonical_vacancy_organization_relationships",
      "canonical_vacancy_evidence_references",
      "idx_canonical_vacancy_source_observation",
      "idx_canonical_vacancy_relationship_employer_cluster",
      "idx_canonical_vacancy_relationship_organization",
    ]) {
      expect(names).toContain(expectedName);
    }
    db.close();
  });

  it("creates employer recognition tables, indexes, constraints, and foreign keys", () => {
    const db = createDatabase(":memory:");
    expect(db.prepare(`
      SELECT version, name FROM schema_migrations WHERE version = 3
    `).get()).toEqual({ version: 3, name: "create_employer_recognition" });
    const names = new Set(
      (db.prepare(`
        SELECT name FROM sqlite_master
        WHERE name LIKE '%employer_cluster%'
           OR name LIKE '%observation_cluster%'
      `).all() as Array<{ name: string }>).map(({ name }) => name),
    );
    for (const name of [
      "employer_clusters",
      "observation_cluster_assignments",
      "uq_observation_cluster_effective_assignment",
      "uq_observation_cluster_current_proposal",
      "idx_observation_cluster_assignment_history",
      "idx_observation_cluster_effective_membership",
    ]) {
      expect(names).toContain(name);
    }
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => db.prepare(`
      INSERT INTO employer_clusters (
        id, status, created_at, updated_at, resolved_employer_id
      ) VALUES ('invalid', 'RESOLVED', '2026-01-01', '2026-01-01', NULL)
    `).run()).toThrow();
    db.prepare(`
      INSERT INTO source_observations (
        id, source_type, source_name, observed_at, metadata_json
      ) VALUES ('observation-1', 'MANUAL', 'test', '2026-08-29T00:00:00.000Z', '{}')
    `).run();
    db.prepare(`
      INSERT INTO employer_clusters (id, status, created_at, updated_at)
      VALUES ('cluster-1', 'UNRESOLVED', '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z')
    `).run();
    const insertAssignment = db.prepare(`
      INSERT INTO observation_cluster_assignments (
        id, source_observation_id, employer_cluster_id, confidence, status,
        algorithm, algorithm_version, evaluated_at
      ) VALUES (?, 'observation-1', 'cluster-1', ?, ?, ?, ?, '2026-08-29T00:00:00.000Z')
    `);
    for (const values of [
      ["bad-status", 0.5, "INVALID", "matcher", "1"],
      ["bad-confidence", 1.1, "REJECTED", "matcher", "1"],
      ["bad-algorithm", 0.5, "REJECTED", " ", "1"],
      ["bad-version", 0.5, "REJECTED", "matcher", " "],
    ] as const) {
      expect(() => insertAssignment.run(...values)).toThrow();
    }
    expect(() => db.prepare(`
      INSERT INTO observation_cluster_assignments (
        id, source_observation_id, employer_cluster_id, confidence, status,
        algorithm, algorithm_version, evaluated_at
      ) VALUES (
        'bad-foreign-key', 'missing', 'cluster-1', 0.5, 'REJECTED',
        'matcher', '1', '2026-08-29T00:00:00.000Z'
      )
    `).run()).toThrow();
    db.close();
  });

  it("upgrades existing canonical data through migration 004", async () => {
    const db = createDatabase(":memory:");
    const observations = new SqliteSourceObservationRepository(db);
    for (const id of ["heuft-a", "heuft-b"]) {
      await observations.save({
        id,
        source: { sourceType: "MANUAL", sourceName: "upgrade-test" },
        observedAt: new Date("2026-08-29T08:00:00.000Z"),
        metadata: {},
      });
    }
    const canonical = new SqliteCanonicalVacancyRepository(db);
    const vacancy = heuftVacancy();
    await canonical.save(vacancy);

    db.exec(`
      DROP TABLE canonical_vacancy_exact_identity_claims;
      DROP TABLE canonical_vacancy_observation_claims;
      DROP INDEX idx_canonical_vacancy_single_observation_membership;
      DELETE FROM schema_migrations WHERE version = 4;
    `);

    migrateDatabase(db);

    expect(await observations.findById("heuft-a")).toMatchObject({ id: "heuft-a" });
    expect(await canonical.findById(vacancy.id)).toEqual(vacancy);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM employer_clusters`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all())
      .toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
      ]);
    db.close();
  });

  it("rejects conflicting historical membership during migration 004", () => {
    const db = createDatabase(":memory:");
    db.exec(`
      DROP TABLE canonical_vacancy_exact_identity_claims;
      DROP TABLE canonical_vacancy_observation_claims;
      DROP INDEX idx_canonical_vacancy_single_observation_membership;
      DELETE FROM schema_migrations WHERE version = 4;
      INSERT INTO canonical_vacancies (
        id, canonicalization_status, derivation_algorithm,
        derivation_algorithm_version, derived_at, created_at, updated_at
      ) VALUES
        ('conflict-a', 'PARTIAL', 'test', '1', '2026-01-01', '2026-01-01', '2026-01-01'),
        ('conflict-b', 'PARTIAL', 'test', '1', '2026-01-01', '2026-01-01', '2026-01-01');
      INSERT INTO canonical_vacancy_source_observations (
        canonical_vacancy_id, source_observation_id, observation_order
      ) VALUES
        ('conflict-a', 'shared-observation', 0),
        ('conflict-b', 'shared-observation', 0);
    `);
    expect(() => migrateDatabase(db)).toThrow(/belongs to multiple canonical vacancies/u);
    expect(db.prepare(`SELECT version FROM schema_migrations WHERE version = 4`).get())
      .toBeUndefined();
    db.close();
  });

  it("rejects conflicting historical exact identities during migration 004", () => {
    const db = createDatabase(":memory:");
    db.exec(`
      DROP TABLE canonical_vacancy_exact_identity_claims;
      DROP TABLE canonical_vacancy_observation_claims;
      DROP INDEX idx_canonical_vacancy_single_observation_membership;
      DELETE FROM schema_migrations WHERE version = 4;
      INSERT INTO source_observations (
        id, source_type, source_name, external_id, observed_at, metadata_json
      ) VALUES
        ('identity-a', 'JOB_BOARD', ' Indeed ', 'ABC', '2026-01-01', '{}'),
        ('identity-b', 'JOB_BOARD', 'indeed', 'ABC', '2026-01-01', '{}');
      INSERT INTO canonical_vacancies (
        id, canonicalization_status, derivation_algorithm,
        derivation_algorithm_version, derived_at, created_at, updated_at
      ) VALUES
        ('identity-canonical-a', 'PARTIAL', 'test', '1', '2026-01-01', '2026-01-01', '2026-01-01'),
        ('identity-canonical-b', 'PARTIAL', 'test', '1', '2026-01-01', '2026-01-01', '2026-01-01');
      INSERT INTO canonical_vacancy_source_observations (
        canonical_vacancy_id, source_observation_id, observation_order
      ) VALUES
        ('identity-canonical-a', 'identity-a', 0),
        ('identity-canonical-b', 'identity-b', 0);
    `);
    expect(() => migrateDatabase(db)).toThrow(/identity integrity error/u);
    expect(db.prepare(`SELECT version FROM schema_migrations WHERE version = 4`).get())
      .toBeUndefined();
    db.close();
  });
});
