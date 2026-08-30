import type { ExtractedVacancyEvidence } from "./ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractionInput } from "./VacancyEvidenceInput.js";

export interface VacancyEvidenceExtractor {
  extract(input: VacancyEvidenceExtractionInput): Promise<ExtractedVacancyEvidence>;
}
