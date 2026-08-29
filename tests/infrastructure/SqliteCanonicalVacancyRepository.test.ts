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
