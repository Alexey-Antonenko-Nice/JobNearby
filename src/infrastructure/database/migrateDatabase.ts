import type Database from "better-sqlite3";

import { migration001 } from "./migrations/001_create_source_observations.js";
import { migration002 } from "./migrations/002_create_canonical_vacancies.js";
import { migration003 } from "./migrations/003_create_employer_recognition.js";

interface Migration {
  version: number;
  name: string;
  up(db: Database.Database): void;
}

const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
];

export function migrateDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: number }>;

  const appliedVersions = new Set(
    appliedRows.map((row) => row.version),
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      migration.up(db);

      db.prepare(`
        INSERT INTO schema_migrations (
          version,
          name,
          applied_at
        )
        VALUES (?, ?, ?)
      `).run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });

    applyMigration();
  }
}
