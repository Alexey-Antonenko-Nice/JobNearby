import type Database from "better-sqlite3";

export const migration006 = {
  version: 6,
  name: "add_browser_capture_snapshot_fingerprints_and_occurrences",
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE source_observations ADD COLUMN content_fingerprint TEXT;
      CREATE UNIQUE INDEX idx_source_observation_identity_fingerprint
        ON source_observations(source_name, external_id, content_fingerprint)
        WHERE external_id IS NOT NULL AND content_fingerprint IS NOT NULL;
      CREATE TABLE capture_occurrences (
        id TEXT PRIMARY KEY,
        source_observation_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        captured_url TEXT NOT NULL,
        FOREIGN KEY (source_observation_id) REFERENCES source_observations(id)
      );
      CREATE INDEX idx_capture_occurrence_source_observation
        ON capture_occurrences(source_observation_id, captured_at, id);
    `);
  },
} as const;