import Database from "better-sqlite3";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCaptureDiagnosticSqlFilter,
  openCaptureDiagnosticDatabase,
  parseCaptureDiagnosticArgs,
  type CaptureDiagnosticQuery,
} from "../../src/infrastructure/database/reportRecentCapturesCli.js";

describe("capture diagnostic CLI", () => {
  it("uses the current default limit", () => {
    expect(parseCaptureDiagnosticArgs([])).toEqual({ limit: 50, latest: false });
  });

  it("preserves the positional limit", () => {
    expect(parseCaptureDiagnosticArgs(["20"])).toEqual({ limit: 20, latest: false });
  });

  it("accepts an explicit limit", () => {
    expect(parseCaptureDiagnosticArgs(["--limit", "20"])).toEqual({
      limit: 20,
      latest: false,
    });
  });

  it("accepts the npm-facing keyword grammar", () => {
    expect(parseCaptureDiagnosticArgs([
      "latest", "provider", " linkedin.com ",
    ])).toEqual({
      limit: 1,
      latest: true,
      provider: "linkedin.com",
    });
    expect(parseCaptureDiagnosticArgs([
      "limit", "20", "external-id", " 000123456 ",
    ])).toEqual({
      limit: 20,
      latest: false,
      externalVacancyId: "000123456",
    });
  });

  it("makes latest an explicit limit of one", () => {
    expect(parseCaptureDiagnosticArgs(["--latest"])).toEqual({ limit: 1, latest: true });
  });

  it("trims and preserves exact provider and external ID strings", () => {
    expect(parseCaptureDiagnosticArgs([
      "--provider", " linkedin.com ", "--external-id", " 004449077982 ",
    ])).toEqual({
      limit: 50,
      latest: false,
      provider: "linkedin.com",
      externalVacancyId: "004449077982",
    });
  });

  it.each([
    [["--limit", "0"], /--limit.*1 and 500/u],
    [["--limit", "501"], /--limit.*1 and 500/u],
    [["--limit", "abc"], /--limit.*1 and 500/u],
    [["--provider"], /--provider.*requires a value/u],
    [["--provider", "   "], /--provider.*non-empty/u],
    [["--external-id"], /--external-id.*requires a value/u],
    [["--external-id", "   "], /--external-id.*non-empty/u],
    [["--unknown"], /Unknown option.*--unknown/u],
    [["unknown"], /Unknown option or keyword.*unknown/u],
    [["provider", "latest"], /--provider.*requires a value/u],
    [["--latest", "--limit", "1"], /--latest.*explicit limit/u],
    [["20", "--limit", "20"], /either the positional limit or "--limit"/u],
    [["--provider", "a", "--provider", "b"], /--provider.*only be specified once/u],
  ] as const)("rejects invalid arguments %j", (args, message) => {
    expect(() => parseCaptureDiagnosticArgs(args)).toThrow(message);
  });
});

describe("capture diagnostic filtering", () => {
  function select(query: CaptureDiagnosticQuery) {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE source_observations (
        id TEXT PRIMARY KEY, source_name TEXT NOT NULL,
        external_id TEXT, observed_at TEXT NOT NULL
      );
      INSERT INTO source_observations VALUES
        ('old-match', 'linkedin.com', '0042', '2026-01-01T00:00:00Z'),
        ('new-nonmatch', 'other.example', '0042', '2026-01-03T00:00:00Z'),
        ('new-match', 'linkedin.com', '0042', '2026-01-02T00:00:00Z');
    `);
    const filter = buildCaptureDiagnosticSqlFilter(query);
    const rows = db.prepare(`
      SELECT observation.id
      FROM source_observations AS observation
      ${filter.whereClause}
      ORDER BY observation.observed_at DESC, observation.id DESC
      LIMIT ?
    `).all(...filter.parameters, query.limit) as Array<{ id: string }>;
    db.close();
    return rows.map(({ id }) => id);
  }

  it("combines exact provider and external-ID filters with AND semantics", () => {
    const query = parseCaptureDiagnosticArgs([
      "provider", "linkedin.com", "external-id", "0042",
    ]);
    expect(select(query)).toEqual(["new-match", "old-match"]);
  });

  it("filters before applying the final limit", () => {
    const query = parseCaptureDiagnosticArgs(["provider", "linkedin.com", "limit", "1"]);
    expect(select(query)).toEqual(["new-match"]);
  });

  it("returns no rows when there are no exact matches", () => {
    const query = parseCaptureDiagnosticArgs(["--provider", "LinkedIn.com"]);
    expect(select(query)).toEqual([]);
  });
});

describe("capture diagnostic database access", () => {
  const databasePath = join(process.cwd(), ".report-recent-captures-readonly-test.sqlite");

  afterEach(() => {
    if (existsSync(databasePath)) unlinkSync(databasePath);
  });

  it("keeps the database readonly with query_only enabled", () => {
    const writable = new Database(databasePath);
    writable.exec("CREATE TABLE marker (value TEXT)");
    writable.close();

    const diagnostic = openCaptureDiagnosticDatabase(databasePath);
    expect(diagnostic.pragma("query_only", { simple: true })).toBe(1);
    expect(() => diagnostic.prepare("INSERT INTO marker VALUES ('changed')").run())
      .toThrow(/readonly/u);
    diagnostic.close();

    const verification = new Database(databasePath, { readonly: true });
    expect(verification.prepare("SELECT COUNT(*) AS count FROM marker").get())
      .toEqual({ count: 0 });
    verification.close();
  });
});
