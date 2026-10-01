import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";
import { migration001 } from "../../src/infrastructure/database/migrations/001_create_source_observations.js";
import { migration002 } from "../../src/infrastructure/database/migrations/002_create_canonical_vacancies.js";
import { migration003 } from "../../src/infrastructure/database/migrations/003_create_employer_recognition.js";
import { migration004 } from "../../src/infrastructure/database/migrations/004_create_canonical_vacancy_identity_claims.js";
import { migration005 } from "../../src/infrastructure/database/migrations/005_create_user_vacancy_interaction_events.js";
import { migration006 } from "../../src/infrastructure/database/migrations/006_add_browser_capture_occurrences.js";
import { migration007 } from "../../src/infrastructure/database/migrations/007_create_employer_alias_evidence.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqlitePublicationFamilyRepository } from "../../src/infrastructure/persistence/SqlitePublicationFamilyRepository.js";
import { SqliteRecruitmentCampaignRepository } from "../../src/infrastructure/persistence/SqliteRecruitmentCampaignRepository.js";
import { heuftVacancy } from "../vacancies/CanonicalVacancyRepository.contract.js";

const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
const at = "2026-10-01T00:00:00.000Z";
const date = new Date(at);
function fresh() { const db = createDatabase(":memory:"); dbs.push(db); return db; }
async function seed(db: Database.Database) {
  const observations = new SqliteSourceObservationRepository(db);
  for (const id of ["o1", "o2", "heuft-a", "heuft-b"]) await observations.save({ id, source: { sourceType: "JOB_BOARD", sourceName: "example.com" }, observedAt: date, metadata: {} });
  await new SqliteEmployerClusterRepository(db).save({ id: "e1", status: "UNRESOLVED", createdAt: date, updatedAt: date });
}
async function fixture() {
  const db = fresh(); await seed(db);
  const families = new SqlitePublicationFamilyRepository(db);
  for (const id of ["f1", "f2"]) await families.save({ id, createdAt: date, updatedAt: date });
  const campaigns = new SqliteRecruitmentCampaignRepository(db);
  for (const id of ["c1", "c2"]) await campaigns.save({ id, employerClusterId: "e1", status: "UNKNOWN", firstObservedAt: date, lastObservedAt: date, createdAt: date, updatedAt: date });
  return db;
}
function addFamily(db: Database.Database, id = "fm1", owner = "f1", observation = "o1") {
  db.prepare(`INSERT INTO publication_family_memberships
    (id, publication_family_id, source_observation_id, confidence, status, algorithm, algorithm_version, evaluated_at, created_at, source_type, decision_key)
    VALUES (?, ?, ?, 1, 'USER_CONFIRMED', 'manual', '1', ?, ?, 'USER_CONFIRMED', ?)`).run(id, owner, observation, at, at, id);
}
function addCampaign(db: Database.Database, id = "cm1", owner = "c1", family: string | null = null, observation: string | null = "o1") {
  db.prepare(`INSERT INTO recruitment_campaign_memberships
    (id, recruitment_campaign_id, publication_family_id, source_observation_id, confidence, status, algorithm, algorithm_version, evaluated_at, created_at, source_type, decision_key)
    VALUES (?, ?, ?, ?, 1, 'USER_CONFIRMED', 'manual', '1', ?, ?, 'USER_CONFIRMED', ?)`).run(id, owner, family, observation, at, at, id);
}
describe("M12.8 additive migration", () => {
  it("creates version 8 tables, indexes, target columns and restrictive foreign keys", () => {
    const db = fresh();
    expect(db.prepare("SELECT version, name FROM schema_migrations WHERE version = 8").get()).toEqual({ version: 8, name: "create_publication_families_and_recruitment_campaigns" });
    for (const table of ["publication_families", "publication_family_memberships", "recruitment_campaigns", "recruitment_campaign_memberships"]) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toEqual({ name: table });
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      expect(columns.map((c) => c.name)).not.toContain("canonical_vacancy_id");
    }
    for (const index of ["idx_recruitment_campaign_employer", "idx_publication_family_observation_history", "idx_publication_family_members", "idx_recruitment_campaign_members", "idx_recruitment_campaign_observation_history", "idx_recruitment_campaign_family_history", "uq_publication_family_active_observation", "uq_recruitment_campaign_active_family", "uq_recruitment_campaign_active_observation"]) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)).toEqual({ name: index });
    }
    const foreignKeys = db.prepare("PRAGMA foreign_key_list(recruitment_campaign_memberships)").all() as { table: string; on_delete: string }[];
    expect(foreignKeys.map((f) => f.table).sort()).toEqual(["publication_families", "recruitment_campaigns", "source_observations"]);
    expect(foreignKeys.every((f) => f.on_delete === "RESTRICT")).toBe(true);
  });
  it("upgrades a populated version 7 database without rewriting public/private data", async () => {
    const db = new Database(":memory:"); dbs.push(db); db.pragma("foreign_keys = ON");
    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [migration001, migration002, migration003, migration004, migration005, migration006, migration007]) {
      migration.up(db); db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(migration.version, migration.name, at);
    }
    await seed(db);
    const canonical = new SqliteCanonicalVacancyRepository(db); const vacancy = heuftVacancy(); await canonical.save(vacancy);
    const oldTables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    const snapshots = () => oldTables.map((name) => db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all());
    const before = snapshots(); migrateDatabase(db); migrateDatabase(db);
    expect(snapshots()).toEqual(before);
    expect(await canonical.findById(vacancy.id)).toEqual(vacancy);
    expect(db.prepare("SELECT count(*) AS n FROM schema_migrations").get()).toEqual({ n: 8 });
    expect(db.prepare("SELECT * FROM recruitment_campaign_memberships").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("enforces family exclusivity and allows membership after supersession", async () => {
    const db = await fixture(); addFamily(db);
    expect(() => addFamily(db, "other", "f2")).toThrow(/UNIQUE/);
    db.prepare("UPDATE publication_family_memberships SET superseded_at = ? WHERE id = 'fm1'").run(at);
    addFamily(db, "other", "f2");
    expect(db.prepare("SELECT count(*) AS n FROM publication_family_memberships").get()).toEqual({ n: 2 });
  });
  it("enforces unique active campaign relationships without exclusive ownership", async () => {
    const db = await fixture(); addCampaign(db); addCampaign(db, "cm2", "c2");
    expect(() => addCampaign(db, "duplicate")).toThrow(/UNIQUE/);
    addCampaign(db, "family1", "c1", "f1", null); addCampaign(db, "family2", "c2", "f1", null);
    expect(() => addCampaign(db, "family-duplicate", "c1", "f1", null)).toThrow(/UNIQUE/);
  });
  it("enforces XOR for both missing and double targets", async () => {
    const db = await fixture();
    expect(() => addCampaign(db, "none", "c1", null, null)).toThrow(/CHECK/);
    expect(() => addCampaign(db, "both", "c1", "f1", "o1")).toThrow(/CHECK/);
  });
  it("enforces family preference without retroactively changing direct memberships", async () => {
    const db = await fixture(); addCampaign(db);
    const before = db.prepare("SELECT * FROM recruitment_campaign_memberships").all(); addFamily(db);
    expect(db.prepare("SELECT * FROM recruitment_campaign_memberships").all()).toEqual(before);
    expect(() => addCampaign(db, "new", "c2")).toThrow(/active publication family/);
    addCampaign(db, "family", "c2", "f1", null);
  });
  it("rejects missing references at the database boundary", async () => {
    const db = await fixture();
    expect(() => addFamily(db, "bad", "missing")).toThrow(/FOREIGN KEY/);
    expect(() => addFamily(db, "bad", "f1", "missing")).toThrow(/FOREIGN KEY/);
    expect(() => addCampaign(db, "bad", "missing")).toThrow(/FOREIGN KEY/);
    expect(() => addCampaign(db, "bad", "c1", "missing", null)).toThrow(/FOREIGN KEY/);
    expect(() => addCampaign(db, "bad", "c1", null, "missing")).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare("UPDATE recruitment_campaigns SET employer_cluster_id = 'missing'").run()).toThrow(/FOREIGN KEY/);
  });
  it("preserves history against deletion, edits and supersession reversal", async () => {
    const db = await fixture(); addFamily(db); addCampaign(db, "family", "c1", "f1", null);
    for (const table of ["publication_family_memberships", "recruitment_campaign_memberships"]) {
      expect(() => db.prepare(`DELETE FROM ${table}`).run()).toThrow(/cannot be deleted/);
      expect(() => db.prepare(`UPDATE ${table} SET explanation = 'rewritten'`).run()).toThrow(/immutable/);
      db.prepare(`UPDATE ${table} SET superseded_at = ?`).run(at);
      expect(() => db.prepare(`UPDATE ${table} SET superseded_at = NULL`).run()).toThrow(/immutable/);
    }
    for (const [table, id] of [["source_observations", "o1"], ["publication_families", "f1"], ["recruitment_campaigns", "c1"], ["employer_clusters", "e1"]]) {
      expect(() => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)).toThrow(/FOREIGN KEY/);
    }
  });
  it("uses indexes for member, target and employer lookups", async () => {
    const db = await fixture();
    for (const query of ["SELECT * FROM publication_family_memberships WHERE source_observation_id = 'o1'", "SELECT * FROM publication_family_memberships WHERE publication_family_id = 'f1'", "SELECT * FROM recruitment_campaign_memberships WHERE publication_family_id = 'f1'", "SELECT * FROM recruitment_campaign_memberships WHERE source_observation_id = 'o1'", "SELECT * FROM recruitment_campaign_memberships WHERE recruitment_campaign_id = 'c1'", "SELECT * FROM recruitment_campaigns WHERE employer_cluster_id = 'e1'"]) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as { detail: string }[];
      expect(plan.some((r) => /SEARCH .* USING INDEX/.test(r.detail))).toBe(true);
    }
  });
});
