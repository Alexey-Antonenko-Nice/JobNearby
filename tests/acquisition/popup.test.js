import { describe, expect, it } from "vitest";

import { captureFeedback } from "../../browser-extension/popup.js";

const processed = {
  processing: {
    status: "PROCESSED",
    vacancyOutcome: "CREATED",
    canonicalizationStatus: "USABLE",
    employerStatus: "MATCHED_EXISTING_RECORD",
  },
};

describe("browser capture popup feedback", () => {
  it("renders concise processing results", () => {
    expect(captureFeedback(processed)).toBe(
      "Captured into a new vacancy record. Linked to an existing employer record.",
    );
    expect(captureFeedback({ processing: { ...processed.processing, vacancyOutcome: "UPDATED_EXISTING", employerStatus: "UNRESOLVED_RECORD_CREATED" } })).toBe(
      "Captured and added to an existing vacancy record. Employer not identified yet.",
    );
    expect(captureFeedback({ processing: { ...processed.processing, employerStatus: "REVIEW_REQUIRED" } })).toBe(
      "Captured into a new vacancy record. Employer match needs review.",
    );
  });

  it("qualifies conflicts without alarming on partial results", () => {
    expect(captureFeedback({ processing: { ...processed.processing, canonicalizationStatus: "CONFLICTED" } })).toContain(
      "Some captured vacancy details conflict.",
    );
    expect(captureFeedback({ processing: { ...processed.processing, canonicalizationStatus: "PARTIAL" } })).not.toContain("conflict");
  });

  it("reports post-capture processing failure without calling capture a failure", () => {
    expect(captureFeedback({ processing: { status: "FAILED" } })).toBe(
      "Captured, but processing did not finish.",
    );
  });
});