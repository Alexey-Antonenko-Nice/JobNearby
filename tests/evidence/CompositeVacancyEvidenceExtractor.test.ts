import { describe, expect, it } from "vitest";

import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import type { VacancyEvidenceExtractor } from "../../src/domain/evidence/VacancyEvidenceExtractor.js";
import { CompositeVacancyEvidenceExtractor } from "../../src/application/evidence/CompositeVacancyEvidenceExtractor.js";
import { createExtractedVacancyEvidence } from "../../src/domain/evidence/ExtractedVacancyEvidence.js";

const observation: SourceObservation = {
  id: "observation-1",
  source: { sourceType: "MANUAL", sourceName: "test" },
  observedAt: new Date("2026-08-23T00:00:00.000Z"),
  metadata: {},
};
const provenance = {
  sourceObservationId: observation.id,
  extractionMethod: "TEXT_EXTRACTION" as const,
  confidence: 0.98,
};

describe("CompositeVacancyEvidenceExtractor", () => {
  it("merges extractors in order and deduplicates exact equivalent evidence", async () => {
    const result = createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations: [
        { value: "ACME", role: "EMPLOYER", provenance },
      ],
    });
    const extractor: VacancyEvidenceExtractor = { async extract() { return result; } };
    const composite = new CompositeVacancyEvidenceExtractor([extractor, extractor]);

    await expect(composite.extract(observation)).resolves.toMatchObject({
      sourceObservationId: observation.id,
      organizations: [{ value: "ACME", role: "EMPLOYER" }],
    });
  });

  it("rejects an extractor aggregate attributed to another observation", async () => {
    const extractor: VacancyEvidenceExtractor = {
      async extract() {
        return createExtractedVacancyEvidence({ sourceObservationId: "other" });
      },
    };
    const composite = new CompositeVacancyEvidenceExtractor([extractor]);

    await expect(composite.extract(observation)).rejects.toThrow(
      "Composite evidence must originate",
    );
  });
});
