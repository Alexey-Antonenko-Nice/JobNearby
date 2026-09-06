import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

export class JoobleSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "JOOBLE") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const html = observation.evidenceContent.context.html ?? "";
    const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu.exec(html)?.[1];
    const location = /data-test-name=["']_regionLink["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/iu.exec(html)?.[1];
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: text(title), provenance }] }),
      ...(location === undefined ? {} : { locations: [{ value: text(location), role: "WORKPLACE" as const, provenance }] }),
      organizations: /MécanoJob|recrutement\s+des\s+Métiers/iu.test(text(html)) ? [{ value: "MécanoJob", role: "RECRUITER" as const, provenance }] : [],
    });
  }
}
function text(value: string): string { return value.replace(/<[^>]+>/gu, " ").replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, " ").replace(/\s+/gu, " ").trim(); }
