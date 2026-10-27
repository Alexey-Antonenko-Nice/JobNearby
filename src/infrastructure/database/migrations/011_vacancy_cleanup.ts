import type Database from "better-sqlite3";

/** User cleanup is the sole scoped exception to append-only vacancy history.
 * Shared agency memory keeps its historical origin ID after the vacancy is gone. */
export const migration011 = {
  version: 11,
  name: "vacancy_archive_and_controlled_cleanup",
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE vacancy_cleanup_state (
        canonical_vacancy_id TEXT PRIMARY KEY REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        archived_at TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
      );
      CREATE TABLE shared_employer_source_evidence (
        source_vacancy_id TEXT NOT NULL, evidence_ref_id TEXT NOT NULL,
        source_observation_id TEXT NOT NULL REFERENCES source_observations(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL, PRIMARY KEY(source_vacancy_id,evidence_ref_id)
      );
      CREATE TABLE deleted_vacancy_records (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
      CREATE TABLE vacancy_cleanup_guard (canonical_vacancy_id TEXT PRIMARY KEY);
      CREATE TABLE vacancy_cleanup_source_guard (source_observation_id TEXT PRIMARY KEY);
      CREATE TRIGGER cleanup_guard_requires_archive BEFORE INSERT ON vacancy_cleanup_guard
        WHEN NOT EXISTS (SELECT 1 FROM vacancy_cleanup_state WHERE canonical_vacancy_id=NEW.canonical_vacancy_id AND archived_at IS NOT NULL)
        BEGIN SELECT RAISE(ABORT, 'Archive the vacancy before deleting.'); END;
      CREATE TRIGGER cleanup_source_guard_requires_owner BEFORE INSERT ON vacancy_cleanup_source_guard
        WHEN NOT EXISTS (SELECT 1 FROM canonical_vacancy_observation_claims c JOIN vacancy_cleanup_guard g ON g.canonical_vacancy_id=c.canonical_vacancy_id WHERE c.source_observation_id=NEW.source_observation_id)
        BEGIN SELECT RAISE(ABORT, 'Cleanup source does not belong to the archived vacancy.'); END;
      ALTER TABLE source_observations ADD COLUMN retired_at TEXT;
      DROP INDEX idx_source_observation_identity_fingerprint;
      CREATE UNIQUE INDEX idx_source_observation_identity_fingerprint ON source_observations(source_name, external_id, content_fingerprint)
        WHERE external_id IS NOT NULL AND content_fingerprint IS NOT NULL AND retired_at IS NULL;
      CREATE TRIGGER deleted_vacancy_no_recreation BEFORE INSERT ON canonical_vacancies
        WHEN EXISTS (SELECT 1 FROM deleted_vacancy_records WHERE id=NEW.id)
        BEGIN SELECT RAISE(ABORT, 'Vacancy was deleted. Reload the page.'); END;
      CREATE TRIGGER retired_source_no_claim BEFORE INSERT ON canonical_vacancy_observation_claims
        WHEN EXISTS (SELECT 1 FROM source_observations WHERE id=NEW.source_observation_id AND retired_at IS NOT NULL)
        BEGIN SELECT RAISE(ABORT, 'Capture was deleted. Reload the page.'); END;
      CREATE TRIGGER retired_source_no_membership BEFORE INSERT ON canonical_vacancy_source_observations
        WHEN EXISTS (SELECT 1 FROM source_observations WHERE id=NEW.source_observation_id AND retired_at IS NOT NULL)
        BEGIN SELECT RAISE(ABORT, 'Capture was deleted. Reload the page.'); END;
    `);
    for (const [trigger, table, column, guard, key] of [
      ["prevent_user_vacancy_interaction_event_delete", "user_vacancy_interaction_events", "canonical_vacancy_id", "vacancy_cleanup_guard", "canonical_vacancy_id"],
      ["vacancy_role_decisions_no_delete", "vacancy_organization_role_decisions", "canonical_vacancy_id", "vacancy_cleanup_guard", "canonical_vacancy_id"],
      ["publication_family_history_no_delete", "publication_family_memberships", "source_observation_id", "vacancy_cleanup_source_guard", "source_observation_id"],
      ["recruitment_campaign_history_no_delete", "recruitment_campaign_memberships", "source_observation_id", "vacancy_cleanup_source_guard", "source_observation_id"],
    ]) db.exec(`DROP TRIGGER ${trigger}; CREATE TRIGGER ${trigger} BEFORE DELETE ON ${table}
      WHEN NOT EXISTS (SELECT 1 FROM ${guard} WHERE ${key}=OLD.${column})
      BEGIN SELECT RAISE(ABORT, 'History is append-only outside confirmed vacancy cleanup.'); END;`);
    // No other table has an FK to agency memory. Rebuild only its origin-vacancy
    // FK: this shared record and its immutable source must survive local cleanup.
    const definition = (db.prepare("SELECT sql FROM sqlite_master WHERE name='confirmed_organization_roles'").get() as { sql: string }).sql;
    db.exec(`DROP TRIGGER confirmed_organization_roles_no_update; DROP TRIGGER confirmed_organization_roles_no_delete;
      DROP INDEX idx_confirmed_organization_role_name;
      ALTER TABLE confirmed_organization_roles RENAME TO cleanup_old_agency_memory;`);
    db.exec(definition.replace("REFERENCES canonical_vacancies(id) ON DELETE RESTRICT", ""));
    db.exec(`INSERT INTO confirmed_organization_roles SELECT * FROM cleanup_old_agency_memory;
      DROP TABLE cleanup_old_agency_memory;
      CREATE INDEX idx_confirmed_organization_role_name ON confirmed_organization_roles(normalized_name);
      CREATE TRIGGER confirmed_organization_roles_no_update BEFORE UPDATE ON confirmed_organization_roles
        BEGIN SELECT RAISE(ABORT, 'Agency memory is append-only'); END;
      CREATE TRIGGER confirmed_organization_roles_no_delete BEFORE DELETE ON confirmed_organization_roles
        BEGIN SELECT RAISE(ABORT, 'Agency memory is append-only'); END;`);
  },
} as const;
