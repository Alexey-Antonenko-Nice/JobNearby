import type { SourceObservation } from "../capture/SourceObservation.js";
import type { ExtractedVacancyEvidence } from "./ExtractedVacancyEvidence.js";

export interface VacancyEvidenceExtractor {
  extract(observation: SourceObservation): Promise<ExtractedVacancyEvidence>;
}
