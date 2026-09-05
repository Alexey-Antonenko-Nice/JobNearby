import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../../src/infrastructure/runtime/createCaptureProcessingRuntime.js";

const url = "https://jobsearch.daimlertruck.com/index.php?ac=jobad&id=425255";

describe("Daimler Truck repeated capture convergence", () => {
  it("reuses an unchanged snapshot while preserving each capture occurrence", async () => {
    const database = createDatabase(":memory:");
    try {
      const runtime = createCaptureProcessingRuntime(database);
      const first = await capture(runtime, `${url}&utm_source=one`, "2026-09-02T10:00:00Z");
      const second = await capture(runtime, `https://jobsearch.daimlertruck.com/index.php?utm_source=two&id=425255&ac=jobad#details`, "2026-09-02T11:00:00Z");
      expect(first.processing).toMatchObject({ status: "PROCESSED" });
      expect(second.processing).toMatchObject({ status: "PROCESSED" });
      if (first.processing.status !== "PROCESSED" || second.processing.status !== "PROCESSED") throw new Error("Expected processing.");
      expect(second.processing.canonicalVacancyId).toBe(first.processing.canonicalVacancyId);
      expect(database.prepare("SELECT COUNT(*) AS count FROM source_observations").get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM capture_occurrences").get()).toEqual({ count: 2 });
    } finally { database.close(); }
  });
});

async function capture(runtime: ReturnType<typeof createCaptureProcessingRuntime>, pageUrl: string, capturedAt: string) {
  return runtime.captureAndProcessBrowserVacancy({ pageUrl, pageTitle: "Daimler Truck", visibleText: "same evidence", capturedAt });
}