import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { critFacts } from "../acquisition/CritVacancy.js";

export class CritVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "CRIT" ? selected.context : undefined;
    const facts = context?.html ? critFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const summary = facts.values["Contract"]!;
    const hours = /\btemps plein\b/iu.test(summary) ? "FULL_TIME" : /\btemps partiel\b/iu.test(summary) ? "PART_TIME" : undefined;
    const hoursRaw = hours ? [`${hours === "FULL_TIME" ? "Temps plein" : "Temps partiel"} (Summary)`] : [];
    const contracts = [ ["INTERIM", /\bint[eé]rim\b/giu], ["INDEFINITE", /\bCDI\b/giu], ["FIXED_TERM", /\bCDD\b/giu] ] as const;
    const engagements = contracts.flatMap(([term, pattern]) => {
      const rawTerms = [...summary.matchAll(pattern)].map(match => `${match[0]} (Summary)`);
      rawTerms.push(...[...facts.description.matchAll(pattern)].map(match => `${match[0]} (Job description)`));
      return rawTerms.length ? [{ rawTerms: [...new Set([...rawTerms, ...hoursRaw])], normalizedTerms: [term, ...(hours ? [hours] : [])], provenance }] : [];
    });
    if (!engagements.length && hours) engagements.push({ rawTerms: hoursRaw, normalizedTerms: [hours], provenance });
    const pay = /^(\d+(?:[.,]\d{1,2})?)\s*€\s+to\s+(\d+(?:[.,]\d{1,2})?)\s*€\s+per\s+(hour|month|year)$/iu.exec(facts.values["Salary"] ?? "");
    const amount = (v: string) => Number(v.replace(",", "."));
    const name = typeof context?.metadata?.organizationName === "string" ? context.metadata.organizationName : undefined;
    const intermediary = /\b(?:recherchons|recrutons)\s+pour\s+(?:le\s+compte\s+de\s+)?notre\s+client\b|\bnotre\s+client\b[^.!?\n]{0,200}\b(?:recherche|recrute)\b/iu.test(facts.description);
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.values["Location"]!, role: "WORKPLACE", provenance }], engagements,
      ...(pay && amount(pay[2]!) >= amount(pay[1]!) ? { compensations: [{ rawText: facts.values["Salary"]!, currency: "EUR", minimum: amount(pay[1]!), maximum: amount(pay[2]!), period: pay[3]!.toUpperCase() as "HOUR" | "MONTH" | "YEAR", provenance }] } : {}),
      ...(name ? { organizations: [{ value: name, role: "DISPLAYED_COMPANY", provenance: { ...provenance, extractionMethod: "DIRECT_FIELD" as const } },
        ...(intermediary ? [{ value: name, role: "STAFFING_AGENCY" as const, provenance }] : [])] } : {}),
    });
  }
}
