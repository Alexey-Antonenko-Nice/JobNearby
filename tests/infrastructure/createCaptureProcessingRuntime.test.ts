import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

describe("createCaptureProcessingRuntime", () => {
  it("uses one migrated SQLite database to persist repeated exact-identity captures into one history", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const payload = {
        pageUrl: "https://www.hellowork.com/fr-fr/emplois/123",
        pageTitle: "Maintenance role",
        visibleText: "Technicien Maintenance\nExample employer\nStrasbourg",
        capturedAt: "2026-08-30T10:00:00Z",
      };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      const second = await runtime.captureAndProcessBrowserVacancy({
        ...payload,
        capturedAt: "2026-08-30T11:00:00Z",
      });
      expect(first.processing.status).toBe("PROCESSED");
      expect(second.processing.status).toBe("PROCESSED");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") {
        throw new Error("Expected processing to succeed.");
      }
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(second.processing.vacancyOutcome).toBe("UPDATED_EXISTING");
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get())
        .toEqual({ count: 2 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM canonical_vacancy_source_observations
        WHERE canonical_vacancy_id = ?
      `).get(first.processing.canonicalVacancyId)).toEqual({ count: 2 });
      expect(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    } finally {
      database.close();
    }
  });
});