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

    expect(rows).toHaveLength(1);

    db.close();
  });
});
