import type Database from "better-sqlite3";

export const migration003 = {
  version: 3,
  name: "create_employer_recognition",

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE employer_clusters (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN (
          'UNRESOLVED', 'PROBABLY_RESOLVED', 'RESOLVED', 'CONFLICTED'
        )),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_employer_id TEXT,
        primary_location_hint TEXT,
        display_label TEXT,
        CHECK (status <> 'RESOLVED' OR resolved_employer_id IS NOT NULL),
        CHECK (status <> 'UNRESOLVED' OR resolved_employer_id IS NULL)
      );

      CREATE TABLE observation_cluster_assignments (
        id TEXT PRIMARY KEY,
        source_observation_id TEXT NOT NULL,
        employer_cluster_id TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL CHECK (status IN (
          'PROPOSED', 'ACCEPTED', 'REJECTED', 'USER_CONFIRMED'
        )),
        algorithm TEXT NOT NULL CHECK (length(trim(algorithm)) > 0),
        algorithm_version TEXT NOT NULL
          CHECK (length(trim(algorithm_version)) > 0),
        evaluated_at TEXT NOT NULL,
        explanation TEXT,
        superseded_at TEXT,
        FOREIGN KEY (source_observation_id)
          REFERENCES source_observations(id),
        FOREIGN KEY (employer_cluster_id)
          REFERENCES employer_clusters(id)
      );

      CREATE INDEX idx_observation_cluster_assignment_history
        ON observation_cluster_assignments(
          source_observation_id, evaluated_at, id
        );

      CREATE INDEX idx_observation_cluster_effective_membership
        ON observation_cluster_assignments(
          employer_cluster_id, source_observation_id
        )
        WHERE superseded_at IS NULL
          AND status IN ('ACCEPTED', 'USER_CONFIRMED');

      CREATE UNIQUE INDEX uq_observation_cluster_effective_assignment
        ON observation_cluster_assignments(source_observation_id)
        WHERE superseded_at IS NULL
          AND status IN ('ACCEPTED', 'USER_CONFIRMED');

      CREATE UNIQUE INDEX uq_observation_cluster_current_proposal
        ON observation_cluster_assignments(source_observation_id)
        WHERE superseded_at IS NULL AND status = 'PROPOSED';
    `);
  },
} as const;
