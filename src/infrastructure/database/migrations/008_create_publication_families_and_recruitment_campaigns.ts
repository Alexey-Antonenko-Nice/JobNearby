import type Database from "better-sqlite3";

export const migration008 = {
  version: 8,
  name: "create_publication_families_and_recruitment_campaigns",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE publication_families (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
        representative_title TEXT
      );
      CREATE TABLE recruitment_campaigns (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
        employer_cluster_id TEXT NOT NULL REFERENCES employer_clusters(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE','PROBABLY_ACTIVE','ENDED','RECURRENT','UNKNOWN')),
        first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL CHECK (last_observed_at >= first_observed_at),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
        occupation_json TEXT, location_json TEXT, position_count_json TEXT
      );
      CREATE INDEX idx_recruitment_campaign_employer ON recruitment_campaigns(employer_cluster_id, id);
    `);
    for (const kind of ["publication_family", "recruitment_campaign"] as const) {
      const family = kind === "publication_family";
      const table = `${kind}_memberships`;
      db.exec(`
        CREATE TABLE ${table} (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
          ${family ? "publication_family_id TEXT NOT NULL REFERENCES publication_families(id) ON DELETE RESTRICT," :
            "recruitment_campaign_id TEXT NOT NULL REFERENCES recruitment_campaigns(id) ON DELETE RESTRICT, publication_family_id TEXT REFERENCES publication_families(id) ON DELETE RESTRICT,"}
          source_observation_id TEXT ${family ? "NOT NULL" : ""} REFERENCES source_observations(id) ON DELETE RESTRICT,
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          status TEXT NOT NULL CHECK (status IN ('PROPOSED','ACCEPTED','REJECTED','USER_CONFIRMED')),
          algorithm TEXT NOT NULL CHECK (length(trim(algorithm)) > 0),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          evaluated_at TEXT NOT NULL, created_at TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('USER_CONFIRMED','SYSTEM_MANUAL','TEST_FIXTURE')),
          explanation TEXT,
          superseded_at TEXT CHECK (superseded_at IS NULL OR (superseded_at >= created_at AND superseded_at >= evaluated_at)),
          decision_key TEXT NOT NULL UNIQUE
          ${family ? "" : ", CHECK ((publication_family_id IS NULL) <> (source_observation_id IS NULL))"}
        );
        CREATE INDEX idx_${kind}_observation_history ON ${table}(source_observation_id, evaluated_at, id);
        CREATE INDEX idx_${kind}_members ON ${table}(${kind}_id, evaluated_at, id);
        CREATE TRIGGER ${kind}_history_no_delete BEFORE DELETE ON ${table}
          BEGIN SELECT RAISE(ABORT, 'Membership history cannot be deleted.'); END;
        CREATE TRIGGER ${kind}_history_immutable BEFORE UPDATE ON ${table}
          WHEN NEW.id IS NOT OLD.id OR NEW.${kind}_id IS NOT OLD.${kind}_id
            ${family ? "" : "OR NEW.publication_family_id IS NOT OLD.publication_family_id"}
            OR NEW.source_observation_id IS NOT OLD.source_observation_id
            OR NEW.confidence IS NOT OLD.confidence OR NEW.status IS NOT OLD.status
            OR NEW.algorithm IS NOT OLD.algorithm OR NEW.algorithm_version IS NOT OLD.algorithm_version
            OR NEW.evaluated_at IS NOT OLD.evaluated_at OR NEW.created_at IS NOT OLD.created_at
            OR NEW.source_type IS NOT OLD.source_type OR NEW.explanation IS NOT OLD.explanation
            OR NEW.decision_key IS NOT OLD.decision_key
            OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NOT OLD.superseded_at)
          BEGIN SELECT RAISE(ABORT, 'Membership decisions are immutable; use supersession.'); END;
      `);
    }
    db.exec(`
      CREATE UNIQUE INDEX uq_publication_family_active_observation
        ON publication_family_memberships(source_observation_id)
        WHERE superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED');
      CREATE INDEX idx_recruitment_campaign_family_history
        ON recruitment_campaign_memberships(publication_family_id, evaluated_at, id);
      CREATE UNIQUE INDEX uq_recruitment_campaign_active_family
        ON recruitment_campaign_memberships(recruitment_campaign_id, publication_family_id)
        WHERE superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED') AND publication_family_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_recruitment_campaign_active_observation
        ON recruitment_campaign_memberships(recruitment_campaign_id, source_observation_id)
        WHERE superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED') AND source_observation_id IS NOT NULL;
      CREATE TRIGGER recruitment_campaign_prefer_family BEFORE INSERT ON recruitment_campaign_memberships
        WHEN NEW.source_observation_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM publication_family_memberships WHERE source_observation_id = NEW.source_observation_id
            AND superseded_at IS NULL AND status IN ('ACCEPTED','USER_CONFIRMED')
        ) BEGIN SELECT RAISE(ABORT, 'Target the active publication family instead of its observation.'); END;
    `);
  },
} as const;
