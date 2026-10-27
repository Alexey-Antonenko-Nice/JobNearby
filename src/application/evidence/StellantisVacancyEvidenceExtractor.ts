import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { stellantisFacts } from "../acquisition/StellantisVacancy.js";
export class StellantisVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const facts = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "STELLANTIS" && selected.context.html ? stellantisFacts(selected.context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const terms = [...(facts.contract === "CDI" ? ["INDEFINITE"] : []), ...(facts.professionalStatus === "Cadre" ? ["CADRE"] : [])];
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }],
      ...(facts.city ? { locations: [{ value: facts.city, role: "WORKPLACE", provenance }] } : {}),
      ...(terms.length ? { engagements: [{ rawTerms: [...(facts.contract === "CDI" ? ["CDI"] : []), ...(facts.professionalStatus === "Cadre" ? ["Statut : Cadre"] : [])], normalizedTerms: terms, provenance }] } : {}),
      ...(/\bChez Stellantis, nous évaluons les candidats\b/u.test(facts.profile) ? { organizations: [{ value: "Stellantis", role: "DISPLAYED_COMPANY", provenance: { ...provenance, confidence: 0.98 } }] } : {}),
    });
  }
}
