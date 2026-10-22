import type Database from "better-sqlite3";

export const migration009 = {
  version: 9,
  name: "create_confirmed_organization_roles",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE confirmed_organization_roles (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        identity_key TEXT NOT NULL CHECK (length(trim(identity_key)) > 0),
        organization_id TEXT,
        organization_name TEXT NOT NULL CHECK (length(trim(organization_name)) > 0),
        normalized_name TEXT NOT NULL CHECK (length(trim(normalized_name)) > 0),
        role TEXT NOT NULL CHECK (role IN ('RECRUITER', 'STAFFING_AGENCY')),
        source_type TEXT NOT NULL CHECK (source_type = 'USER_CONFIRMED'),
        source_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE RESTRICT,
        source_observation_id TEXT NOT NULL REFERENCES source_observations(id) ON DELETE RESTRICT,
        supporting_evidence_ids_json TEXT NOT NULL CHECK (json_valid(supporting_evidence_ids_json)
          AND json_type(supporting_evidence_ids_json) = 'array' AND json_array_length(supporting_evidence_ids_json) > 0),
        created_at TEXT NOT NULL,
        UNIQUE (identity_key, normalized_name, role)
      );
      CREATE INDEX idx_confirmed_organization_role_name ON confirmed_organization_roles(normalized_name);
      CREATE TRIGGER confirmed_organization_roles_no_update BEFORE UPDATE ON confirmed_organization_roles
        BEGIN SELECT RAISE(ABORT, 'Agency memory is append-only'); END;
      CREATE TRIGGER confirmed_organization_roles_no_delete BEFORE DELETE ON confirmed_organization_roles
        BEGIN SELECT RAISE(ABORT, 'Agency memory is append-only'); END;
    `);
  },
} as const;
