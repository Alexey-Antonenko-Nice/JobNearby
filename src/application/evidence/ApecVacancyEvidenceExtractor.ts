import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { apecFacts, parseApecSalary } from "../acquisition/ApecVacancy.js";

export class ApecVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "APEC" ? selected.context : undefined;
    const facts = context?.html ? apecFacts(context.html) : undefined;
    if (!facts || facts.apecReference !== context?.providerExternalId) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const contract = /^CDI$/iu.test(facts.contract ?? "") ? "INDEFINITE" : /^CDD$/iu.test(facts.contract ?? "") ? "FIXED_TERM" : undefined;
    const pay = facts.salaryText ? parseApecSalary(facts.salaryText) : undefined;
    // The embedded JSON-LD can only corroborate the visible range. Any disagreement
    // leaves the salary as original text without normalized amounts.
    const structured = record(record(context?.metadata?.matchedJobPosting)?.baseSalary);
    const amount = record(structured?.value);
    const agrees = structured === undefined || (structured.currency === "EUR" && amount?.unitText === pay?.period
      && Number(amount?.minValue) === pay?.minimum && Number(amount?.maxValue) === pay?.maximum);
    const compensation = pay && agrees ? pay : facts.salaryText ? { rawText: facts.salaryText } : undefined;
    return createExtractedVacancyEvidence({
      sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }],
      ...(facts.location ? { locations: [{ value: facts.location, role: "WORKPLACE" as const, provenance }] } : {}),
      ...(contract ? { engagements: [{ rawTerms: [facts.contract!], normalizedTerms: [contract], provenance }] } : {}),
      ...(compensation ? { compensations: [{ ...compensation, provenance }] } : {}),
      // The visible company is only what APEC displays. No employer role is inferred from it.
      ...(facts.company ? { organizations: [{ value: facts.company, role: "DISPLAYED_COMPANY" as const, provenance }] } : {}),
      externalIdentifiers: [{ value: facts.apecReference, provider: input.source.sourceName, identifierType: "APEC_REFERENCE", provenance }],
    });
  }
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
