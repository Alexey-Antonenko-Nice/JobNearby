import type Database from "better-sqlite3";

/** Logical metadata evolves independently of immutable versions and associations. */
export const migration016 = {
  version:16,
  name:"application_document_lifecycle",
  up(db:Database.Database):void {
    db.exec(`
      CREATE TABLE application_document_changes (
        request_id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL REFERENCES application_documents(id) ON DELETE RESTRICT,
        operation TEXT NOT NULL CHECK(operation IN ('RENAME','ARCHIVE','RESTORE')),
        name TEXT,
        created_at TEXT NOT NULL,
        CHECK((operation='RENAME' AND name IS NOT NULL AND length(trim(name)) BETWEEN 1 AND 200)
          OR (operation IN ('ARCHIVE','RESTORE') AND name IS NULL))
      );
      CREATE INDEX idx_document_changes_document ON application_document_changes(document_id);
      CREATE INDEX idx_document_associations_version ON vacancy_application_documents(document_version_id);
      CREATE TRIGGER document_changes_no_update BEFORE UPDATE ON application_document_changes
        BEGIN SELECT RAISE(ABORT,'Document lifecycle history is immutable.'); END;
      CREATE TRIGGER document_changes_no_delete BEFORE DELETE ON application_document_changes
        BEGIN SELECT RAISE(ABORT,'Document lifecycle history cannot be deleted.'); END;
    `);
  }
} as const;
