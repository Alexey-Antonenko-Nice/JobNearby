import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import {
  heuftVacancy,
  runCanonicalVacancyRepositoryContract,
} from "../vacancies/CanonicalVacancyRepository.contract.js";

runCanonicalVacancyRepositoryContract("SQLite", () => {
  const db = createDatabase(":memory:");
  return {
    repository: new SqliteCanonicalVacancyRepository(db),
    saveObservation: (observation) =>
      new SqliteSourceObservationRepository(db).save(observation),
    close: () => db.close(),
  };
});

describe("SqliteCanonicalVacancyRepository integrity", () => {
  it("rolls back an identity claim when exact-identity persistence fails", async () => {
    const db = createDatabase(":memory:");
    const observations = new SqliteSourceObservationRepository(db);
    await observations.save({
      id: "claim-rollback",
      source: {
        sourceType: "JOB_BOARD",
        sourceName: "Indeed",
        externalId: "ROLLBACK",
      },
      observedAt: new Date("2026-08-29T12:00:00.000Z"),
      metadata: {},
    });
    db.exec(`
      CREATE TRIGGER fail_exact_identity_claim
      BEFORE INSERT ON canonical_vacancy_exact_identity_claims
      BEGIN
        SELECT RAISE(ABORT, 'injected identity claim failure');
      END;
    `);
    const repository = new SqliteCanonicalVacancyRepository(db);
    await expect(
      repository.claimIdentity("claim-rollback", "canonical-rollback"),
    ).rejects.toThrow(/injected identity claim failure/u);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM canonical_vacancy_observation_claims
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM canonical_vacancy_exact_identity_claims
    `).get()).toEqual({ count: 0 });
    db.close();
  });

  it("converges claims made through independent repository instances", async () => {
    const db = createDatabase(":memory:");
    const observations = new SqliteSourceObservationRepository(db);
    for (const id of ["concurrent-a", "concurrent-b"]) {
      await observations.save({
        id,
        source: {
          sourceType: "JOB_BOARD",
          sourceName: id === "concurrent-a" ? " Indeed " : "indeed",
          externalId: "CONCURRENT",
        },
        observedAt: new Date("2026-08-29T12:00:00.000Z"),
        metadata: {},
      });
    }
    const first = new SqliteCanonicalVacancyRepository(db);
    const second = new SqliteCanonicalVacancyRepository(db);
    const winner = await first.claimIdentity("concurrent-a", "canonical-first");
    const converged = await second.claimIdentity("concurrent-b", "canonical-second");
    expect(winner).toEqual({
      canonicalVacancyId: "canonical-first",
      outcome: "CLAIMED",
    });
    expect(converged).toEqual({
      canonicalVacancyId: "canonical-first",
      outcome: "EXISTING",
    });
    expect(db.prepare(`
      SELECT COUNT(DISTINCT canonical_vacancy_id) AS count
      FROM canonical_vacancy_observation_claims
    `).get()).toEqual({ count: 1 });
    db.close();
  });

  it("rolls back the complete projection replacement when a child insert fails", async () => {
    const db = createDatabase(":memory:");
    const repository = new SqliteCanonicalVacancyRepository(db);
    const original = heuftVacancy();
    await repository.save(original);
    db.exec(`
      CREATE TRIGGER fail_canonical_field_insert
      BEFORE INSERT ON canonical_vacancy_fields
      WHEN NEW.field_name = 'workMode'
      BEGIN
        SELECT RAISE(ABORT, 'injected canonical persistence failure');
      END;
    `);
    const replacement = structuredClone(original);
    (replacement.role as { value: { title: string } }).value.title = "Changed title";
    await expect(repository.save(replacement)).rejects.toThrow(
      /injected canonical persistence failure/u,
    );
    expect(await repository.findById(original.id)).toEqual(original);
    db.close();
  });

  it("rejects a corrupt unknown field status on retrieval", async () => {
    const db = createDatabase(":memory:");
    const repository = new SqliteCanonicalVacancyRepository(db);
    const vacancy = heuftVacancy();
    await repository.save(vacancy);
    db.pragma("ignore_check_constraints = ON");
    db.prepare(`
      UPDATE canonical_vacancy_fields
      SET status = 'BROKEN'
      WHERE canonical_vacancy_id = ? AND field_name = 'role'
    `).run(vacancy.id);
    await expect(repository.findById(vacancy.id)).rejects.toThrow(
      /field status is invalid/u,
    );
    db.close();
  });

  it("rejects a conflicted stored field with missing alternatives", async () => {
    const db = createDatabase(":memory:");
    const repository = new SqliteCanonicalVacancyRepository(db);
    const vacancy = heuftVacancy();
    await repository.save(vacancy);
    db.prepare(`
      UPDATE canonical_vacancy_fields
      SET status = 'CONFLICTED'
      WHERE canonical_vacancy_id = ? AND field_name = 'role'
    `).run(vacancy.id);
    await expect(repository.findById(vacancy.id)).rejects.toThrow(
      /incompatible alternatives/u,
    );
    db.close();
  });

  it("rejects evidence traceability corrupted outside source membership", async () => {
    const db = createDatabase(":memory:");
    const repository = new SqliteCanonicalVacancyRepository(db);
    const vacancy = heuftVacancy();
    await repository.save(vacancy);
    db.pragma("foreign_keys = OFF");
    db.prepare(`
      UPDATE canonical_vacancy_evidence_references
      SET source_observation_id = 'outside-observation'
      WHERE canonical_vacancy_id = ?
    `).run(vacancy.id);
    await expect(repository.findById(vacancy.id)).rejects.toThrow(
      /outside vacancy observations/u,
    );
    db.close();
  });
});
