import type Database from "better-sqlite3";
export const migration018={version:18,name:"contact_activity",up(db:Database.Database):void {
  db.exec(`
    CREATE TABLE interaction_contact_references (
      event_id TEXT PRIMARY KEY NOT NULL REFERENCES user_vacancy_interaction_events(id) ON DELETE CASCADE,
      canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT
    );
    CREATE TABLE action_contact_references (
      action_id TEXT PRIMARY KEY NOT NULL,
      canonical_vacancy_id TEXT NOT NULL,
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      FOREIGN KEY(action_id,canonical_vacancy_id) REFERENCES vacancy_next_actions(id,canonical_vacancy_id) ON DELETE CASCADE
    );
    CREATE TABLE interaction_requests (
      request_id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL UNIQUE REFERENCES user_vacancy_interaction_events(id) ON DELETE CASCADE,
      canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL
    );
    CREATE INDEX interaction_contact_person ON interaction_contact_references(contact_id);
    CREATE INDEX action_contact_person ON action_contact_references(contact_id);
    CREATE TRIGGER interaction_contact_vacancy BEFORE INSERT ON interaction_contact_references
      WHEN NOT EXISTS(SELECT 1 FROM user_vacancy_interaction_events WHERE id=NEW.event_id AND canonical_vacancy_id=NEW.canonical_vacancy_id)
      BEGIN SELECT RAISE(ABORT,'Interaction contact vacancy mismatch.'); END;
  `);
  for(const table of ["interaction_contact_references","action_contact_references","interaction_requests"]){
    db.exec(`CREATE INDEX ${table}_vacancy ON ${table}(canonical_vacancy_id);
      CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Contact activity is immutable.'); END;
      CREATE TRIGGER ${table}_guarded_delete BEFORE DELETE ON ${table}
      WHEN NOT EXISTS(SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id)
      BEGIN SELECT RAISE(ABORT,'Contact activity requires guarded cleanup.'); END;`);
  }
}} as const;
