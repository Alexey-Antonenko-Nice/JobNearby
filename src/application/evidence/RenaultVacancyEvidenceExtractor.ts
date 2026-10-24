import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { renaultFacts } from "../acquisition/RenaultWorkdayVacancy.js";

export class RenaultVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "RENAULT_WORKDAY" ? selected.context : undefined;
    const facts = context?.html ? renaultFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const hours = /^Temps plein$/u.test(facts.values.time ?? "") ? "FULL_TIME" : /^Temps partiel$/u.test(facts.values.time ?? "") ? "PART_TIME" : undefined;
    const frenchInternship = /\bstage\b/iu.test(facts.title) && /\b(?:objectif du stage|lieu du stage)\b/iu.test(facts.description);
    // The French interface does not determine the vacancy's language. Require
    // explicit student-training wording, not the title or language alone.
    const spanishTraining = /\bLa beca permitiría al estudiante adquirir conocimientos prácticos[^\n]*/iu.exec(facts.description)?.[0];
    const spanishInternship = /^Becari[oa]$/iu.test(facts.title) && spanishTraining !== undefined
      && /\bbajo la tutela del equipo\b/iu.test(facts.description);
    const internshipTerms = frenchInternship ? ["Stage"] : spanishInternship ? [facts.title, spanishTraining!] : undefined;
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }],
      locations: [{ value: facts.values.locations!, role: "WORKPLACE", provenance }],
      engagements: [...(hours ? [{ rawTerms: [facts.values.time!], normalizedTerms: [hours], provenance }] : []),
        ...(internshipTerms ? [{ rawTerms: internshipTerms, normalizedTerms: ["INTERNSHIP"], provenance }] : [])],
      ...(facts.company ? { organizations: [{ value: facts.company, role: "DISPLAYED_COMPANY", provenance }, { value: facts.company, role: "EMPLOYER", provenance }] } : {}),
    });
  }
}
