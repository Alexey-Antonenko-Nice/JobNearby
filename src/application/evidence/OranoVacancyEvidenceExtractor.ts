import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { oranoFacts } from "../acquisition/OranoVacancy.js";
import { randstadText } from "../acquisition/RandstadVacancy.js";
export class OranoVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "ORANO" ? selected.context : undefined;
    const facts = context?.html ? oranoFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }],
      ...(/^(?:Internship|Stage)$/iu.test(facts.contract ?? "") ? { engagements: [{ rawTerms: [facts.contract!], normalizedTerms: ["INTERNSHIP"], provenance }] } : {}),
      // An explicit Hybrid field supports HYBRID; merely possible telework does not establish a mode.
      ...(/^Hybrid$/iu.test(facts.remoteWork ?? "") ? { workModes: [{ value: "HYBRID", provenance }] } : {}),
      // Vacancy narrative identity, not the BU acronym or site logo. No legal-entity claim.
      ...(/\bChez Orano Aval du futur,\s+nous\b/u.test(randstadText(facts.description)) ? { organizations: [{ value: "Orano Aval du futur", role: "DISPLAYED_COMPANY", provenance }] } : {}),
    });
  }
}
