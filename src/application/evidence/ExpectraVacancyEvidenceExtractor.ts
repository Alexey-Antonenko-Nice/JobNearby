import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { expectraFacts } from "../acquisition/ExpectraVacancy.js";

export class ExpectraVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "EXPECTRA_MONACO" ? selected.context : undefined;
    const facts = context?.html ? expectraFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    return createExtractedVacancyEvidence({ sourceObservationId: input.id, vacancyTitles: [{ value: facts.title, provenance }],
      organizations: [
        ...(context?.metadata?.displayedCompanyName === "Expectra" ? [{ value: "Expectra", role: "DISPLAYED_COMPANY" as const, provenance }] : []),
        ...(context?.metadata?.staffingAgency === true ? [{ value: "Expectra", role: "STAFFING_AGENCY" as const, provenance }] : []),
      ],
    });
  }
}
