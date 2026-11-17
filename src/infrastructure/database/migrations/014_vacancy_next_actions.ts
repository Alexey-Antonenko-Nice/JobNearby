import type Database from "better-sqlite3";

/** Immutable private intentions and an append-only lifecycle/scheduling ledger. */
export const migration014 = {
  version: 14,
  name: "vacancy_next_actions_and_reminders",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE vacancy_next_actions (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 2000),
        due_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(id,canonical_vacancy_id)
      );
      CREATE TABLE vacancy_action_changes (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        action_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('COMPLETE','CANCEL','RESCHEDULE','SET_REMINDER','DISMISS_REMINDER')),
        due_at TEXT,
        remind_at TEXT,
        reminder_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(action_id,canonical_vacancy_id) REFERENCES vacancy_next_actions(id,canonical_vacancy_id) ON DELETE CASCADE,
        CHECK((kind='SET_REMINDER' AND remind_at IS NOT NULL) OR (kind!='SET_REMINDER' AND remind_at IS NULL)),
        CHECK((kind='DISMISS_REMINDER' AND reminder_id IS NOT NULL) OR (kind!='DISMISS_REMINDER' AND reminder_id IS NULL)),
        CHECK(kind='RESCHEDULE' OR due_at IS NULL)
      );
      CREATE INDEX idx_next_actions_vacancy ON vacancy_next_actions(canonical_vacancy_id);
      CREATE INDEX idx_action_changes_vacancy ON vacancy_action_changes(canonical_vacancy_id,action_id);
    `);
    for(const table of ["vacancy_next_actions","vacancy_action_changes"]) {
      db.exec(`
        CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
          BEGIN SELECT RAISE(ABORT,'Action history is append-only.'); END;
        CREATE TRIGGER ${table}_guarded_delete BEFORE DELETE ON ${table}
          WHEN NOT EXISTS(SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id)
          BEGIN SELECT RAISE(ABORT,'Action history requires guarded vacancy cleanup.'); END;
      `);
    }
  }
} as const;
