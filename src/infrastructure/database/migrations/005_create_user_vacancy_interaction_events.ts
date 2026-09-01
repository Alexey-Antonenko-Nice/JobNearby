import type Database from "better-sqlite3";

export const migration005 = {
  version: 5,
  name: "create_user_vacancy_interaction_events",

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE user_vacancy_interaction_events (
        id TEXT PRIMARY KEY,
        canonical_vacancy_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'REVIEWED', 'INTERESTED', 'APPLIED', 'CONTACTED', 'INTERVIEW',
          'OFFER', 'REJECTED', 'WITHDRAWN', 'CLOSED'
        )),
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        metadata_json TEXT,
        FOREIGN KEY (canonical_vacancy_id) REFERENCES canonical_vacancies(id)
      );

      CREATE INDEX idx_user_vacancy_interaction_canonical
        ON user_vacancy_interaction_events(canonical_vacancy_id);

      CREATE INDEX idx_user_vacancy_interaction_history
        ON user_vacancy_interaction_events(
          canonical_vacancy_id, occurred_at, recorded_at, id
        );

      CREATE TRIGGER prevent_user_vacancy_interaction_event_update
      BEFORE UPDATE ON user_vacancy_interaction_events
      BEGIN
        SELECT RAISE(ABORT, 'User vacancy interaction events are append-only');
      END;

      CREATE TRIGGER prevent_user_vacancy_interaction_event_delete
      BEFORE DELETE ON user_vacancy_interaction_events
      BEGIN
        SELECT RAISE(ABORT, 'User vacancy interaction events are append-only');
      END;
    `);
  },
};
