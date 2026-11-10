import { describe, expect, it } from "vitest";
import { captureFeedback } from "../../../browser-extension/popup.js";

describe("capture result feedback contract", () => {
  it("distinguishes rejection, accepted new/existing captures and processing failure", () => {
    const rejected = captureFeedback({ processing: { status: "VACANCY_NOT_DETECTED", captureAcceptedAsVacancy: false } });
    expect(rejected).toBe("Vacancy not detected. This page was not added.");
    expect(rejected).not.toMatch(/employer|error|failed/iu);
    const processed = { status: "PROCESSED", canonicalizationStatus: "USABLE", employerStatus: "UNRESOLVED_RECORD_CREATED" };
    expect(captureFeedback({ processing: { ...processed, vacancyOutcome: "CREATED" } })).toContain("new vacancy record");
    expect(captureFeedback({ processing: { ...processed, vacancyOutcome: "UPDATED_EXISTING" } })).toContain("existing vacancy record");
    expect(captureFeedback({ processing: { status: "FAILED" } })).toBe("Captured, but processing did not finish.");
  });
});
