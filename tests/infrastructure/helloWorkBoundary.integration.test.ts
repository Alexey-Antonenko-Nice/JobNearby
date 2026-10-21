import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";
import { SqliteCanonicalVacancyRepository } from "../../src/infrastructure/persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { helloWorkHtml, helloWorkUrl } from "../fixtures/helloWorkVacancy.js";

describe("HelloWork bounded capture persistence", () => {
  it("reuses exact captures, reprojects harmlessly, and retains continuity on changed snapshots", async () => {
    const db = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(db);
      const sources = new SqliteSourceObservationRepository(db);
      const canonical = new SqliteCanonicalVacancyRepository(db);
      const payload = { pageUrl: helloWorkUrl, pageTitle: "HelloWork", html: helloWorkHtml,
        visibleText: "Technicien de Maintenance H/F\nCrit\n13 € / heure\nFEHR\n32 000 - 36 000 € / an", capturedAt: "2026-10-21T10:00:00Z" };
      const first = await runtime.captureAndProcessBrowserVacancy(payload);
      if (first.processing.status !== "PROCESSED") throw Error("Processing failed");
      const id = first.processing.canonicalVacancyId;
      const originalRows = db.prepare("SELECT * FROM source_observations").all();
      const assignments = db.prepare("SELECT * FROM observation_cluster_assignments").all();
      const clusters = db.prepare("SELECT * FROM employer_clusters").all();
      for (const capturedAt of ["2026-10-21T11:00:00Z", "2026-10-21T12:00:00Z"]) {
        const repeated = await runtime.captureAndProcessBrowserVacancy({ ...payload, capturedAt, pageUrl: `${helloWorkUrl}?utm_source=repeat` });
        expect(repeated.capture.observationId).toBe(first.capture.observationId);
        expect(repeated.processing).toMatchObject({ canonicalVacancyId: id, observationAdded: false });
      }
      expect(await sources.countCaptureOccurrences([first.capture.observationId])).toBe(3);
      expect(db.prepare("SELECT * FROM source_observations").all()).toEqual(originalRows);
      expect(db.prepare("SELECT * FROM observation_cluster_assignments").all()).toEqual(assignments);
      expect(db.prepare("SELECT * FROM employer_clusters").all()).toEqual(clusters);
      const before = (await canonical.findById(id))!;
      expect(before.compensation).toMatchObject({ status: "RESOLVED", value: { minimum: 13, currency: "EUR", period: "HOUR" } });
      expect(JSON.stringify(before.organizationRelationships)).not.toMatch(/FEHR|Outside Agency/);
      const changed = await runtime.captureAndProcessBrowserVacancy({ ...payload, visibleText: payload.visibleText + "\nUpdated current description", html: helloWorkHtml.replace("Le poste requiert", "Ce poste requiert"), capturedAt: "2026-10-22T10:00:00Z" });
      expect(changed.capture.observationId).not.toBe(first.capture.observationId);
      expect(changed.processing).toMatchObject({ canonicalVacancyId: id, observationAdded: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT * FROM employer_clusters").all()).toEqual(clusters);
      expect(db.prepare("SELECT COUNT(DISTINCT employer_cluster_id) AS count FROM observation_cluster_assignments").get()).toEqual({ count: 1 });
      expect(await sources.findById(first.capture.observationId)).toMatchObject({ rawContent: payload.visibleText });
      expect((await canonical.findById(id))?.compensation.value?.period).toBe("HOUR");
    } finally { db.close(); }
  });
});
