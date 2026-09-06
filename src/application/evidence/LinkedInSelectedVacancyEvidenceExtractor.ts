import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

export class LinkedInSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "LINKEDIN") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    if (!/<(?:section|div)\b[^>]*(?:data-linkedin-selected-vacancy-context|data-testid=["']job-header)/iu.test(observation.evidenceContent.context.html ?? "")) return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const text = observation.evidenceContent.context.text ?? "";
    const header = text.split(/\nÀ propos de l['’]offre d['’]emploi\n/iu)[0] ?? text;
    const lines = header.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    const title = lines.find((line, index) => index > 0 && /\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m)\b|maintenance|ing[eé]nieur|technicien/iu.test(line));
    const company = lines[0];
    const location = lines.find((line) => /,\s*(?:France|Occitanie|Grand Est)\b/iu.test(line))?.split(" · ")[0];
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const staffing = /\b(?:cabinet\s+de\s+recrutement|recherche\s+pour\s+son\s+client)\b/iu.test(text);
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: title, provenance }] }),
      organizations: company === undefined || !staffing ? [] : [{ value: company, role: "STAFFING_AGENCY" as const, provenance }],
    });
  }
}
