import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

export class LhhSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "LHH") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const text = observation.evidenceContent.context.text ?? "";
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const staffing = /LHH\s+Recruitment\s+Solutions|cabinet\s+de\s+conseil\s+en\s+recrutement|int[eé]rim\s+sp[eé]cialis[eé]|recherche\s+pour\s+son\s+client/iu.test(text);
    const compensation = /€\s*([\d\s.,]+)\s*[–-]\s*€?\s*([\d\s.,]+)\s*\/\s*(?:year|an)/iu.exec(text);
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations: staffing ? [{ value: "LHH Recruitment Solutions", role: "RECRUITER" as const, provenance }, { value: observation.displayedCompanyName ?? "LHH", role: "STAFFING_AGENCY" as const, provenance }] : [],
      compensations: compensation === null ? [] : [{ rawText: compensation[0], currency: "EUR", minimum: parse(compensation[1]!), maximum: parse(compensation[2]!), period: "YEAR", provenance }],
    });
  }
}
function parse(value: string): number { return Number(value.replace(/[\s.,]/gu, "")); }
