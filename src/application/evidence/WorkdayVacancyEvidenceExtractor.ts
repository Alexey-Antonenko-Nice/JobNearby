import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { extractWorkdayStructuredFields, isWorkdaySource } from "../acquisition/WorkdayVacancy.js";

export class WorkdayVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    const html = observation.metadata.acquisition && typeof observation.metadata.acquisition === "object"
      ? (observation.metadata.acquisition as Record<string, unknown>).html
      : undefined;
    if (typeof html !== "string" || observation.source.sourceUrl === undefined || !isWorkdaySource(observation.source.sourceName, observation.source.sourceUrl)) {
      return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    }
    const fields = extractWorkdayStructuredFields(html, observation.source.sourceUrl);
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1 };
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      locations: (fields?.locationTexts ?? []).map((value) => ({ value, role: "WORKPLACE" as const, provenance })),
    });
  }
}
