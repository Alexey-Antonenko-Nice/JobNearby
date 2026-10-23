import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { kellyFacts } from "../acquisition/KellyWorkdayVacancy.js";

export class KellyVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "KELLY_WORKDAY" ? selected.context : undefined;
    const facts = context?.html ? kellyFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const hours = /^Full time$/iu.test(facts.values.time ?? "") ? "FULL_TIME" : /^Part time$/iu.test(facts.values.time ?? "") ? "PART_TIME" : undefined;
    const workMode = /^In Person$/iu.test(facts.values.remoteType ?? "") ? "ON_SITE" : /^Remote$/iu.test(facts.values.remoteType ?? "") ? "REMOTE" : /^Hybrid$/iu.test(facts.values.remoteType ?? "") ? "HYBRID" : undefined;
    // Currency is supported by the explicit dollar range and US workplace;
    // YEAR comes from the selected description's annual base-pay statement.
    const salaries = [...facts.description.matchAll(/The annual base pay for this position is listed below\.[^$]{0,300}\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)\s*[-–]\s*\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\d.,])/giu)];
    const pay = salaries.length === 1 && /^United States-/u.test(facts.values.locations!) ? salaries[0] : undefined;
    const amount = (value: string) => Number(value.replace(/,/gu, ""));
    const client = facts.intermediary ? /\b(?:for|on behalf of) our client\s+([A-Z][A-Za-z0-9&.-]*(?: [A-Z][A-Za-z0-9&.-]*){0,3})(?=[.,!\n]|$)/u.exec(facts.description)?.[1]?.replace(/[.,;!?]+$/u, "") : undefined;
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.values.locations!, role: "WORKPLACE", provenance }],
      ...(hours ? { engagements: [{ rawTerms: [facts.values.time!], normalizedTerms: [hours], provenance }] } : {}),
      ...(workMode ? { workModes: [{ value: workMode, provenance }] } : {}),
      ...(pay && Number.isFinite(amount(pay[1]!)) && Number.isFinite(amount(pay[2]!)) && amount(pay[2]!) >= amount(pay[1]!) ? { compensations: [{ rawText: pay[0], currency: "USD", minimum: amount(pay[1]!), maximum: amount(pay[2]!), period: "YEAR", provenance }] } : {}),
      ...(facts.name ? { organizations: [{ value: facts.name, role: "DISPLAYED_COMPANY", provenance },
        // Corporate first-person wording supports a contextual employer reading,
        // not a certain explicit identity. Keep it below the recognition path's
        // confidence-1 threshold so the employer remains unresolved until review.
        // Existing agency memory respects contextual direct-employer evidence.
        { value: facts.name, role: facts.intermediary ? "STAFFING_AGENCY" : "EMPLOYER", provenance: facts.intermediary ? provenance : { ...provenance, confidence: 0.98 } },
        ...(client ? [{ value: client, role: "CLIENT" as const, provenance }] : [])] } : {}),
    });
  }
}
