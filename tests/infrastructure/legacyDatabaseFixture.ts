import Database from "better-sqlite3";
import { migration001 } from "../../src/infrastructure/database/migrations/001_create_source_observations.js";
import { migration002 } from "../../src/infrastructure/database/migrations/002_create_canonical_vacancies.js";
import { migration003 } from "../../src/infrastructure/database/migrations/003_create_employer_recognition.js";
import { migration004 } from "../../src/infrastructure/database/migrations/004_create_canonical_vacancy_identity_claims.js";
import { migration005 } from "../../src/infrastructure/database/migrations/005_create_user_vacancy_interaction_events.js";
import { migration006 } from "../../src/infrastructure/database/migrations/006_add_browser_capture_occurrences.js";
import { migration007 } from "../../src/infrastructure/database/migrations/007_create_employer_alias_evidence.js";
import { migration008 } from "../../src/infrastructure/database/migrations/008_create_publication_families_and_recruitment_campaigns.js";

export function versionEightDatabase() {
 const db = new Database(":memory:"); db.pragma("foreign_keys=ON");
 db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)");
 for (const m of [migration001,migration002,migration003,migration004,migration005,migration006,migration007,migration008]) { m.up(db); db.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version,m.name,"2026-10-27"); }
 return db;
}
