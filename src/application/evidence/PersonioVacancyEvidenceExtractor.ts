import { extractPersonioHeaderFacts, extractPersonioVacancyId, isPersonioSource } from "../acquisition/PersonioVacancy.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";

export class PersonioVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    const url = observation.source.sourceUrl;
    const acquisition = observation.metadata.acquisition;
    const html = acquisition && typeof acquisition === "object" ? (acquisition as Record<string, unknown>).html : undefined;
    if (!url || !isPersonioSource(observation.source.sourceName, url) || extractPersonioVacancyId(url) === undefined || typeof html !== "string") {
      return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    }
    const facts = extractPersonioHeaderFacts(html);
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1 };
    const compensation = facts.salaryText === undefined ? undefined : parseAnnualEuroSalary(facts.salaryText);
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      engagements: facts.contractTerms.length === 0 ? [] : [{
        rawTerms: facts.contractTerms,
        normalizedTerms: facts.contractTerms.map((term) => /^full/iu.test(term) ? "FULL_TIME" : /^part[-\s]time$/iu.test(term) ? "PART_TIME" : "INDEFINITE"),
        provenance,
      }],
      compensations: compensation === undefined ? [] : [{ ...compensation, provenance }],
    });
  }
}

/** Personio's explicit single annual EUR amount, with unambiguous grouping only. */
function parseAnnualEuroSalary(rawText: string) {
  const match = /^(?:€\s*([\d., ]+)|([\d., ]+)\s*(?:€|EUR))\s+per year$/iu.exec(rawText);
  if (match === null) return undefined;
  const amount = (match[1] ?? match[2])!.trim();
  const grouped = /^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/u.test(amount);
  if (!grouped && !/^\d+(?:[.,]\d{1,2})?$/u.test(amount)) return undefined;
  const value = Number(grouped ? amount.replace(/[., ]/gu, "") : amount.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return { rawText, currency: "EUR", minimum: value, maximum: value, period: "YEAR" as const };
}
