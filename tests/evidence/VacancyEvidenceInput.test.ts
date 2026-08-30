import { describe, expect, it } from "vitest";

import { ExplicitTextVacancyEvidenceExtractor } from "../../src/application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import { createAcquisitionContext } from "../../src/domain/acquisition/AcquisitionContext.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import {
  fromSelectedVacancyContext,
  fromSourceObservation,
  normalizeVacancyEvidenceInput,
} from "../../src/domain/evidence/VacancyEvidenceInput.js";

const observation: SourceObservation = {
  id: "observation-1",
  source: { sourceType: "JOB_BOARD", sourceName: "LinkedIn" },
  observedAt: new Date("2026-08-30T10:00:00.000Z"),
  description: "Nous recrutons pour notre client, ACME.",
  rawContent: "Full page content remains authoritative.",
  metadata: {},
};

describe("VacancyEvidenceInput", () => {
  it("represents the authoritative observation as the existing evidence input", () => {
    expect(fromSourceObservation(observation)).toEqual({
      ...observation,
      evidenceContent: { kind: "SOURCE_OBSERVATION" },
    });
    expect(normalizeVacancyEvidenceInput(observation)).toEqual(
      fromSourceObservation(observation),
    );
  });

  it("represents a bounded selected context without replacing current extraction content", async () => {
    const context = createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      providerExternalId: "4457266939",
      associationEvidence: ["URL_EXTERNAL_ID", "MATCHING_JOB_DETAILS"],
      text: "Selected detail content that is not interpreted in M5.7.1.",
    });
    const input = fromSelectedVacancyContext(observation, context);
    const extractor = new ExplicitTextVacancyEvidenceExtractor();

    expect(input).toEqual({
      ...observation,
      evidenceContent: { kind: "SELECTED_VACANCY_CONTEXT", context },
    });
    await expect(extractor.extract(input)).resolves.toMatchObject({
      sourceObservationId: observation.id,
      organizations: [{ value: "ACME", role: "EMPLOYER" }],
    });
  });
});