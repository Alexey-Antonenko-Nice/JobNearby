import type Database from "better-sqlite3";
export const migration012 = {
  version: 12,
  name: "private_vacancy_priority_and_notes",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE vacancy_crm_priority (
        canonical_vacancy_id TEXT PRIMARY KEY REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        priority TEXT NOT NULL CHECK(priority IN ('NONE','LOW','NORMAL','HIGH'))
      );
      CREATE TABLE vacancy_notes (
        id TEXT PRIMARY KEY,
        canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        text TEXT NOT NULL CHECK(length(trim(text)) > 0 AND length(text) <= 10000),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_vacancy_notes_chronology ON vacancy_notes(canonical_vacancy_id,created_at);
      CREATE TRIGGER vacancy_notes_no_update BEFORE UPDATE ON vacancy_notes
        BEGIN SELECT RAISE(ABORT, 'Notes are append-only.'); END;
      CREATE TRIGGER vacancy_notes_guarded_delete BEFORE DELETE ON vacancy_notes
        WHEN NOT EXISTS (SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id)
        BEGIN SELECT RAISE(ABORT, 'Notes may only be removed by confirmed vacancy cleanup.'); END;
    `);
  },
} as const;
