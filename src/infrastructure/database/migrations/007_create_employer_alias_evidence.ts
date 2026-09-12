import type Database from "better-sqlite3";

export const migration007 = {
  version: 7,
  name: "create_employer_alias_evidence",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE employer_alias_evidence (
        id TEXT PRIMARY KEY,
        alias_name TEXT NOT NULL CHECK (length(trim(alias_name)) > 0),
        normalized_alias_name TEXT NOT NULL CHECK (length(trim(normalized_alias_name)) > 0),
        employer_cluster_id TEXT NOT NULL REFERENCES employer_clusters(id),
        source_type TEXT NOT NULL CHECK (source_type = 'USER_CONFIRMED_ALIAS'),
        source_assignment_id TEXT NOT NULL REFERENCES observation_cluster_assignments(id),
        created_at TEXT NOT NULL,
        explanation TEXT NOT NULL CHECK (length(trim(explanation)) > 0),
        UNIQUE (employer_cluster_id, normalized_alias_name, source_assignment_id)
      );
      CREATE INDEX idx_employer_alias_name
        ON employer_alias_evidence(normalized_alias_name, employer_cluster_id);
    `);
  },
} as const;
