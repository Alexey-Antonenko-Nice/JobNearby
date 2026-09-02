import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const url = "https://www.randstad.fr/emploi/monteur-assembleur-fh_molsheim_001-mmo-0000054_10l/";

describe("Randstad repeated capture convergence", () => {
  it("reuses an unchanged snapshot while preserving each capture occurrence", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const first = await capture(runtime, `${url}?utm_source=one`, "same evidence", "2026-09-02T10:00:00Z");
      const second = await capture(runtime, `${url}?utm_source=two#details`, "same evidence", "2026-09-02T11:00:00Z");
      expect(first.processing).toMatchObject({ status: "PROCESSED" });
      expect(second.processing).toMatchObject({ status: "PROCESSED" });
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") throw new Error("Expected processing.");
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT captured_url FROM capture_occurrences ORDER BY captured_at").all()).toEqual([
        { captured_url: `${url}?utm_source=one` }, { captured_url: `${url}?utm_source=two#details` },
      ]);
    } finally { database.close(); }
  });

  it("creates a new snapshot for changed content but retains canonical identity", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const first = await capture(runtime, url, "salary 12 EUR", "2026-09-02T10:00:00Z");
      const second = await capture(runtime, url, "salary 13 EUR", "2026-09-03T10:00:00Z");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") throw new Error("Expected processing.");
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });
    } finally { database.close(); }
  });

  it("does not merge identical content from different Randstad listing identities", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const first = await capture(runtime, url, "same evidence", "2026-09-02T10:00:00Z");
      const second = await capture(runtime,
        "https://www.randstad.fr/emploi/monteur-assembleur-fh_benfeld_001-sel-1743760_01c/",
        "same evidence", "2026-09-02T10:00:01Z");
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") throw new Error("Expected processing.");
      expect(second.processing.canonicalVacancyId).not.toBe(first.processing.canonicalVacancyId);
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 2 });
    } finally { database.close(); }
  });

  it("converges concurrent unchanged captures onto one snapshot and canonical vacancy", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const [first, second] = await Promise.all([
        capture(runtime, url, "same evidence", "2026-09-02T10:00:00Z"),
        capture(runtime, url, "same evidence", "2026-09-02T10:00:01Z"),
      ]);
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") throw new Error("Expected processing.");
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });
    } finally { database.close(); }
  });
});

async function capture(runtime: ReturnType<typeof createCaptureProcessingRuntime>, pageUrl: string, visibleText: string, capturedAt: string) {
  return runtime.captureAndProcessBrowserVacancy({ pageUrl, pageTitle: "Randstad", visibleText, capturedAt });
}