import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { michaelPageFacts, michaelPageSalary } from "../acquisition/MichaelPageVacancy.js";

export class MichaelPageVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "MICHAEL_PAGE" ? selected.context : undefined;
    const facts = context?.html ? michaelPageFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const salary = michaelPageSalary(facts.salary);
    const engagement = /^Int[eé]rim$/iu.test(facts.contract) ? "INTERIM" : /^CDI$/iu.test(facts.contract) ? "INDEFINITE" : undefined;
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }],
      ...(engagement ? { engagements: [{ rawTerms: [facts.contract], normalizedTerms: [engagement], provenance }] } : {}),
      ...(salary ? { compensations: [{ ...salary, provenance }] } : {}),
      organizations: [
        ...(context?.metadata?.displayedCompanyName === "Michael Page" ? [{ value: "Michael Page", role: "DISPLAYED_COMPANY" as const, provenance }] : []),
        ...(context?.metadata?.intermediaryName === "Michael Page" ? [
          { value: "Michael Page", role: "STAFFING_AGENCY" as const, provenance },
          { value: "Michael Page", role: "RECRUITMENT_AGENCY" as const, provenance: { ...provenance, confidence: 0.9 } },
        ] : []),
      ],
    });
  }
}
