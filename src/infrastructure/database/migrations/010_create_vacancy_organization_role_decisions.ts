import type Database from "better-sqlite3";
export const migration010 = {
  version: 10,
  name: "create_vacancy_organization_role_decisions",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE vacancy_organization_role_decisions (
        id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
        canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE RESTRICT,
        identity_key TEXT NOT NULL CHECK(length(trim(identity_key)) > 0),
        organization_name TEXT NOT NULL CHECK(length(trim(organization_name)) > 0),
        normalized_name TEXT NOT NULL CHECK(length(trim(normalized_name)) > 0),
        role TEXT NOT NULL CHECK(role IN ('EMPLOYER','STAFFING_AGENCY','RECRUITER','CLIENT','CONSULTANCY')),
        previous_decision_id TEXT REFERENCES vacancy_organization_role_decisions(id) ON DELETE RESTRICT,
        basis_json TEXT NOT NULL CHECK(json_valid(basis_json) AND json_type(basis_json) = 'object'),
        override_acknowledged INTEGER NOT NULL CHECK(override_acknowledged IN (0,1)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_vacancy_role_history ON vacancy_organization_role_decisions(canonical_vacancy_id);
      CREATE INDEX idx_organization_role_history ON vacancy_organization_role_decisions(identity_key);
      CREATE UNIQUE INDEX uq_vacancy_role_root ON vacancy_organization_role_decisions(canonical_vacancy_id) WHERE previous_decision_id IS NULL;
      CREATE UNIQUE INDEX uq_vacancy_role_successor ON vacancy_organization_role_decisions(previous_decision_id) WHERE previous_decision_id IS NOT NULL;
      CREATE TRIGGER vacancy_role_decisions_no_update BEFORE UPDATE ON vacancy_organization_role_decisions
        BEGIN SELECT RAISE(ABORT, 'Organization role decisions are append-only'); END;
      CREATE TRIGGER vacancy_role_decisions_no_delete BEFORE DELETE ON vacancy_organization_role_decisions
        BEGIN SELECT RAISE(ABORT, 'Organization role decisions are append-only'); END;
    `);
  }
} as const;
