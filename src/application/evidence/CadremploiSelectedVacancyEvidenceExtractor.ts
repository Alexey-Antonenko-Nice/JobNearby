import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

export class CadremploiSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "CADREMPLOI") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const text = observation.evidenceContent.context.text ?? "";
    const company = observation.displayedCompanyName;
    if (company === undefined) return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const recruiter = /postuler\s+sur\s+le\s+site\s+du\s+recruteur|cabinet\s+de\s+recrutement|recherche\s+pour\s+son\s+client/iu.test(text);
    return createExtractedVacancyEvidence({ sourceObservationId: observation.id, organizations: recruiter ? [{ value: company, role: "RECRUITER" as const, provenance }] : [] });
  }
}
