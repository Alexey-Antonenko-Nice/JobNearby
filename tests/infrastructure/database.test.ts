import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { migrateDatabase } from "../../src/infrastructure/database/migrateDatabase.js";

describe("database migrations", () => {
  it("creates the source observations schema", () => {
    const db = createDatabase(":memory:");

    const migration = db
      .prepare(`
        SELECT version, name
        FROM schema_migrations
        WHERE version = 1
      `)
      .get() as
      | { version: number; name: string }
      | undefined;

    expect(migration).toEqual({
      version: 1,
      name: "create_source_observations",
    });

    const table = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'source_observations'
      `)
      .get() as
      | { name: string }
      | undefined;

    expect(table?.name).toBe("source_observations");

    db.close();
  });

  it("can run migrations more than once safely", () => {
    const db = createDatabase(":memory:");

    expect(() => migrateDatabase(db)).not.toThrow();

    const rows = db
      .prepare(`
        SELECT version
        FROM schema_migrations
      `)
      .all();

    expect(rows).toEqual([{ version: 1 }, { version: 2 }]);

    db.close();
  });

  it("creates the structured canonical vacancy schema and lookup indexes", () => {
    const db = createDatabase(":memory:");
    const migration = db.prepare(`
      SELECT version, name FROM schema_migrations WHERE version = 2
    `).get();
    expect(migration).toEqual({
      version: 2,
      name: "create_canonical_vacancies",
    });

    const objects = db.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name LIKE 'canonical_vacanc%'
         OR name LIKE 'idx_canonical_vacancy%'
    `).all() as Array<{ type: string; name: string }>;
    const names = new Set(objects.map(({ name }) => name));
    for (const expectedName of [
      "canonical_vacancies",
      "canonical_vacancy_fields",
      "canonical_vacancy_field_alternatives",
      "canonical_vacancy_organization_relationships",
      "canonical_vacancy_evidence_references",
      "idx_canonical_vacancy_source_observation",
      "idx_canonical_vacancy_relationship_employer_cluster",
      "idx_canonical_vacancy_relationship_organization",
    ]) {
      expect(names).toContain(expectedName);
    }
    db.close();
  });
});
