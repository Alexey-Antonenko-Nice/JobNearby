import type Database from "better-sqlite3";
export const migration015 = {
  version:15,
  name:"immutable_application_documents_and_vacancy_associations",
  up(db:Database.Database):void {
    db.exec(`
      CREATE TABLE application_documents (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('CV','MOTIVATION_LETTER')),
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
        created_at TEXT NOT NULL
      );
      CREATE TABLE application_document_versions (
        id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL REFERENCES application_documents(id) ON DELETE RESTRICT,
        version_number INTEGER NOT NULL CHECK(version_number>0),
        original_file_name TEXT NOT NULL,
        media_type TEXT,
        size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880),
        content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
        storage_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        request_fingerprint TEXT NOT NULL,
        UNIQUE(document_id,version_number)
      );
      CREATE TABLE vacancy_application_documents (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_vacancy_id TEXT NOT NULL REFERENCES canonical_vacancies(id) ON DELETE CASCADE,
        document_version_id TEXT NOT NULL REFERENCES application_document_versions(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_vacancy_application_documents ON vacancy_application_documents(canonical_vacancy_id);
    `);
    for(const table of ["application_documents","application_document_versions","vacancy_application_documents"]) {
      db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table}
        BEGIN SELECT RAISE(ABORT,'Document history is immutable.'); END;`);
      db.exec(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        ${table==="vacancy_application_documents" ? "WHEN NOT EXISTS (SELECT 1 FROM vacancy_cleanup_guard WHERE canonical_vacancy_id=OLD.canonical_vacancy_id)" : ""}
        BEGIN SELECT RAISE(ABORT,'Document deletion requires an explicit supported cleanup operation.'); END;`);
    }
  }
} as const;
