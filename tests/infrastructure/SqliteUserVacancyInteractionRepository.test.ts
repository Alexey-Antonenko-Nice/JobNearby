import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteUserVacancyInteractionRepository } from "../../src/infrastructure/persistence/SqliteUserVacancyInteractionRepository.js";
import type { UserVacancyInteractionEvent } from "../../src/domain/user/UserVacancyInteractionEvent.js";

const databasePath = join(process.cwd(), ".user-vacancy-interactions-test.sqlite");

describe("SqliteUserVacancyInteractionRepository", () => {
  afterEach(() => { if (existsSync(databasePath)) unlinkSync(databasePath); });

  it("persists append-only typed events across restart", async () => {
    const firstDb = createDatabase(databasePath);
    insertCanonicalVacancy(firstDb, "canonical-1");
    const first = new SqliteUserVacancyInteractionRepository(firstDb);
    await first.append(interaction("applied", "APPLIED", {
      channel: "EMPLOYER_SITE", sourceObservationId: "source-1",
    }));
    await first.append(interaction("contacted", "CONTACTED", {
      direction: "INBOUND", contactMethod: "EMAIL",
    }, "2026-09-02T00:00:00Z"));
    firstDb.close();

    const secondDb = createDatabase(databasePath);
    const restored = await new SqliteUserVacancyInteractionRepository(secondDb)
      .findByCanonicalVacancyId("canonical-1");
    expect(restored).toEqual([
      interaction("applied", "APPLIED", { channel: "EMPLOYER_SITE", sourceObservationId: "source-1" }),
      interaction("contacted", "CONTACTED", { direction: "INBOUND", contactMethod: "EMAIL" }, "2026-09-02T00:00:00Z"),
    ]);
    secondDb.close();
  });

  it("rejects duplicate IDs and missing canonical vacancies", async () => {
    const db = createDatabase(databasePath);
    insertCanonicalVacancy(db, "canonical-1");
    const repository = new SqliteUserVacancyInteractionRepository(db);
    await repository.append(interaction("same", "REVIEWED"));
    await expect(repository.append(interaction("same", "REVIEWED"))).rejects.toThrow(/already exists/u);
    await expect(repository.append({ ...interaction("missing", "REVIEWED"), canonicalVacancyId: "missing" }))
      .rejects.toThrow(/FOREIGN KEY/u);
    db.close();
  });

  it("enforces append-only history at the database boundary", async () => {
    const db = createDatabase(databasePath);
    insertCanonicalVacancy(db, "canonical-1");
    await new SqliteUserVacancyInteractionRepository(db).append(interaction("immutable", "REVIEWED"));
    expect(() => db.prepare(`UPDATE user_vacancy_interaction_events SET event_type = 'CLOSED'`).run())
      .toThrow(/append-only/u);
    expect(() => db.prepare(`DELETE FROM user_vacancy_interaction_events`).run())
      .toThrow(/append-only/u);
    db.close();
  });

  it("does not modify public vacancy, observation, or recognition records", async () => {
    const db = createDatabase(databasePath);
    db.prepare(`INSERT INTO source_observations (
      id, source_type, source_name, observed_at, title, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("source-1", "JOB_BOARD", "Example", "2026-09-01T00:00:00Z", "Engineer", "{}");
    insertCanonicalVacancy(db, "canonical-1");
    db.prepare(`INSERT INTO employer_clusters (id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?)`)
      .run("cluster-1", "UNRESOLVED", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
    db.prepare(`INSERT INTO observation_cluster_assignments (
      id, source_observation_id, employer_cluster_id, confidence, status,
      algorithm, algorithm_version, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("assignment-1", "source-1", "cluster-1", 0.9, "ACCEPTED", "test", "1", "2026-09-01T00:00:00Z");

    const before = publicRows(db);
    await new SqliteUserVacancyInteractionRepository(db).append(interaction("reviewed", "REVIEWED"));
    await new SqliteUserVacancyInteractionRepository(db).append(interaction("applied", "APPLIED", { channel: "JOB_BOARD" }));
    expect(publicRows(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM user_vacancy_interaction_events").get())
      .toEqual({ count: 2 });
    db.close();
  });
});

function insertCanonicalVacancy(db: ReturnType<typeof createDatabase>, id: string): void {
  db.prepare(`INSERT INTO canonical_vacancies (
    id, canonicalization_status, derivation_algorithm, derivation_algorithm_version,
    derived_at, created_at, updated_at
  ) VALUES (?, 'PARTIAL', 'test', '1', ?, ?, ?)`)
    .run(id, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
}

function interaction(
  id: string,
  type: UserVacancyInteractionEvent["type"],
  metadata?: Record<string, string>,
  occurredAt = "2026-09-01T00:00:00Z",
): UserVacancyInteractionEvent {
  return {
    id, canonicalVacancyId: "canonical-1", type,
    occurredAt: new Date(occurredAt), recordedAt: new Date(occurredAt),
    ...(metadata === undefined ? {} : { metadata }),
  } as UserVacancyInteractionEvent;
}

function publicRows(db: ReturnType<typeof createDatabase>) {
  return {
    vacancies: db.prepare("SELECT * FROM canonical_vacancies").all(),
    observations: db.prepare("SELECT * FROM source_observations").all(),
    assignments: db.prepare("SELECT * FROM observation_cluster_assignments").all(),
  };
}
