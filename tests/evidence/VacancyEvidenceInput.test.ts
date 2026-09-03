import { describe, expect, it } from "vitest";

import { DirectFieldVacancyEvidenceExtractor } from "../../src/application/evidence/DirectFieldVacancyEvidenceExtractor.js";
import { ExplicitEmployerCharacteristicExtractor } from "../../src/application/evidence/ExplicitEmployerCharacteristicExtractor.js";
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
  source: { sourceType: "JOB_BOARD", sourceName: "LinkedIn", externalId: "full-page-id" },
  observedAt: new Date("2026-08-30T10:00:00.000Z"),
  description: "Nous recrutons pour notre client, Wrong Description.",
  rawContent: "Nous recrutons pour notre client, Wrong Full Page.",
  contactText: "Contact recrutement: Wrong Contact",
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

  it("preserves source-observation textual extraction semantics", async () => {
    const result = await new ExplicitTextVacancyEvidenceExtractor().extract(
      fromSourceObservation(observation),
    );

    expect(result.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Wrong Description", role: "CLIENT" }),
      expect.objectContaining({ value: "Wrong Full Page", role: "CLIENT" }),
    ]));
    expect(result.people).toContainEqual(expect.objectContaining({
      value: "Wrong Contact",
      provenance: expect.not.objectContaining({ contentOrigin: expect.anything() }),
    }));
  });

  it("uses only bounded selected text and identifies its provenance", async () => {
    const context = createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      providerExternalId: "4457266939",
      associationEvidence: ["URL_EXTERNAL_ID", "MATCHING_JOB_DETAILS"],
      text: "Nous recrutons pour notre client, Selected Employer. Contact recrutement: Selected Recruiter. Our client specializes in concrete manufacturing.",
    });
    const input = fromSelectedVacancyContext(observation, context);

    expect(input).toEqual({
      ...observation,
      evidenceContent: { kind: "SELECTED_VACANCY_CONTEXT", context },
    });
    const textResult = await new ExplicitTextVacancyEvidenceExtractor().extract(input);
    expect(textResult.organizations).toEqual([{
      value: "Selected Employer",
      role: "CLIENT",
      provenance: {
        sourceObservationId: observation.id,
        extractionMethod: "TEXT_EXTRACTION",
        confidence: 0.98,
        contentOrigin: "SELECTED_VACANCY_CONTEXT",
      },
    }]);
    expect(textResult.people).toEqual([expect.objectContaining({
      value: "Selected Recruiter",
      provenance: expect.objectContaining({
        contentOrigin: "SELECTED_VACANCY_CONTEXT",
      }),
    })]);

    const characteristicResult =
      await new ExplicitEmployerCharacteristicExtractor().extract(input);
    expect(characteristicResult.employerCharacteristics).toEqual([
      expect.objectContaining({
        value: "concrete manufacturing",
        provenance: expect.objectContaining({
          contentOrigin: "SELECTED_VACANCY_CONTEXT",
        }),
      }),
    ]);
  });

  it("retains direct observation fields for selected context input", async () => {
    const input = fromSelectedVacancyContext(observation, createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      text: "No textual external ID is interpreted.",
    }));

    const result = await new DirectFieldVacancyEvidenceExtractor().extract(input);
    expect(result.externalIdentifiers).toEqual([expect.objectContaining({
      value: "full-page-id",
      provider: "LinkedIn",
      provenance: {
        sourceObservationId: observation.id,
        extractionMethod: "DIRECT_FIELD",
        confidence: 1,
      },
    })]);
  });
});