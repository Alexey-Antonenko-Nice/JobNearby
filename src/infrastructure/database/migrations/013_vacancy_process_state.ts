import type Database from "better-sqlite3";

export const migration013 = {
  version: 13,
  name: "vacancy_process_state_and_transitions",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE vacancy_crm_process_state (
        canonical_vacancy_id TEXT PRIMARY KEY REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK(state IN (
          'DISCOVERED','REVIEWING','PLANNED_TO_APPLY','APPLIED','AWAITING_RESPONSE',
          'INTERVIEWING','OFFER','REJECTED','WITHDRAWN','NO_LONGER_RELEVANT'
        ))
      );
      CREATE TABLE vacancy_process_transitions (
        id TEXT PRIMARY KEY,
        canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL CHECK(from_state IN (
          'DISCOVERED','REVIEWING','PLANNED_TO_APPLY','APPLIED','AWAITING_RESPONSE',
          'INTERVIEWING','OFFER','REJECTED','WITHDRAWN','NO_LONGER_RELEVANT'
        )),
        to_state TEXT NOT NULL CHECK(to_state IN (
          'DISCOVERED','REVIEWING','PLANNED_TO_APPLY','APPLIED','AWAITING_RESPONSE',
          'INTERVIEWING','OFFER','REJECTED','WITHDRAWN','NO_LONGER_RELEVANT'
        )),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_vacancy_process_transitions_chronology
        ON vacancy_process_transitions(canonical_vacancy_id,created_at);
      CREATE TRIGGER vacancy_process_transitions_no_update BEFORE UPDATE ON vacancy_process_transitions
        BEGIN SELECT RAISE(ABORT, 'Process-state transitions are append-only.'); END;
      CREATE TRIGGER vacancy_process_transitions_guarded_delete BEFORE DELETE ON vacancy_process_transitions
        WHEN NOT EXISTS (SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id)
        BEGIN SELECT RAISE(ABORT, 'Process-state transitions may only be removed by confirmed vacancy cleanup.'); END;
      CREATE TRIGGER vacancy_crm_process_state_guarded_delete BEFORE DELETE ON vacancy_crm_process_state
        WHEN NOT EXISTS (SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id)
        BEGIN SELECT RAISE(ABORT, 'Process state may only be removed by confirmed vacancy cleanup.'); END;
    `);
  },
} as const;
