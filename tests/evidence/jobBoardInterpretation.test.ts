import { describe, expect, it } from "vitest";

import { CoreVacancyHeaderFactsExtractor } from "../../src/application/evidence/CoreVacancyHeaderFactsExtractor.js";
import { ExplicitTextVacancyEvidenceExtractor } from "../../src/application/evidence/ExplicitTextVacancyEvidenceExtractor.js";
import type { SourceObservation } from "../../src/domain/capture/SourceObservation.js";
import { fromSourceObservation } from "../../src/domain/evidence/VacancyEvidenceInput.js";
import { employerConfirmationCandidate } from "../../src/application/user/employerConfirmation.js";
import { ExplicitCandidateRequirementsExtractor } from "../../src/application/evidence/ExplicitCandidateRequirementsExtractor.js";

function observation(provider: string, company: string, text: string): SourceObservation {
  return { id: provider, source: { sourceType: "JOB_BOARD", sourceName: provider, sourceUrl: `https://${provider}/job` }, observedAt: new Date("2026-09-06T12:00:00Z"), displayedCompanyName: company, rawContent: text, metadata: {} };
}

describe("job-board interpretation hardening", () => {
  it("does not classify a HelloWork salary as a workplace", async () => {
    const result = await new CoreVacancyHeaderFactsExtractor().extract(observation("hellowork.com", "INTERIS Haguenau", "Reichstett, Grand Est, FR\n17,50 € / heure"));
    expect(result.locations).toEqual([]);
  });

  it("classifies explicit client-context displayed companies as staffing agencies", async () => {
    const result = await new ExplicitTextVacancyEvidenceExtractor().extract(observation("hellowork.com", "INTERIS Haguenau", "Dans le cadre du développement de l'activité de notre client, nous recherchons un technicien."));
    expect(result.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "INTERIS Haguenau", role: "STAFFING_AGENCY" })]));
    expect(employerConfirmationCandidate([{ role: "DISPLAYED_COMPANY", rawName: "INTERIS Haguenau" }, { role: "STAFFING_AGENCY", rawName: "INTERIS Haguenau" }] as any)).toBeNull();
  });

  it("classifies Meteojob talent-acquisition organization context as staffing", async () => {
    const result = await new ExplicitTextVacancyEvidenceExtractor().extract(observation("meteojob.com", "Actual", "Actual Talent est le spécialiste européen en Acquisition et Évaluation de talents d'Actual group."));
    expect(result.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ value: "Actual", role: "STAFFING_AGENCY" })]));
    expect(employerConfirmationCandidate([{ role: "DISPLAYED_COMPANY", rawName: "Actual" }, { role: "STAFFING_AGENCY", rawName: "Actual" }] as any)).toBeNull();
  });

  it("preserves exact French Unicode through evidence extraction", async () => {
    const text = "Intérim\ndéplacements réguliers\nmaîtrise de l'anglais\n13,50 € / heure";
    const result = await new CoreVacancyHeaderFactsExtractor().extract(observation("hellowork.com", "INTERIS Haguenau", text));
    const requirements = await new ExplicitCandidateRequirementsExtractor().extract(observation("hellowork.com", "INTERIS Haguenau", text));
    expect(text).toContain("Intérim");
    expect(result.engagements[0]?.rawTerms).toEqual(["Intérim"]);
    expect(requirements.travelRequirements[0]?.rawText).toBe("déplacements réguliers");
    expect(requirements.languageRequirements[0]?.rawText).toBe("maîtrise de l'anglais");
  });
});
