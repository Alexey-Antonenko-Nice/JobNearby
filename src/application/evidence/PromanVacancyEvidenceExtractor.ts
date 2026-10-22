import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { promanFacts } from "../acquisition/PromanVacancy.js";

export class PromanVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "PROMAN" ? selected.context : undefined;
    const facts = context?.html ? promanFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const contract = /^CDI$/iu.test(facts.contract) ? "INDEFINITE" : /^CDD$/iu.test(facts.contract) ? "FIXED_TERM" : "INTERIM";
    const rhythm = facts.values["Rythme de travail"];
    const hours = /^Temps plein$/iu.test(rhythm ?? "") ? "FULL_TIME" : /^Temps partiel$/iu.test(rhythm ?? "") ? "PART_TIME" : undefined;
    const pay = /^(\d+(?:[.,]\d{1,2})?)\s*€\s*[-–]\s*(\d+(?:[.,]\d{1,2})?)\s*€\s*\/\s*(h|mois|an)$/iu.exec(facts.salary ?? "");
    const amount = (value: string) => Number(value.replace(",", "."));
    const staffing = contract === "INTERIM" || /\bréseau d['’]agences\b[^.!?\n]{0,100}\brecrutement\b|\bagence d['’]intérim\b/iu.test(facts.job);
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }],
      engagements: [{ rawTerms: [facts.contract, ...(hours ? [`Rythme de travail: ${rhythm}`] : [])], normalizedTerms: [contract, ...(hours ? [hours] : [])], provenance }],
      ...(pay && Number.isFinite(amount(pay[2]!)) && amount(pay[2]!) >= amount(pay[1]!) ? { compensations: [{ rawText: facts.salary!, currency: "EUR", minimum: amount(pay[1]!), maximum: amount(pay[2]!), period: pay[3]!.toLowerCase() === "h" ? "HOUR" : pay[3]!.toLowerCase() === "mois" ? "MONTH" : "YEAR", provenance }] } : {}),
      organizations: [{ value: facts.agency, role: "DISPLAYED_COMPANY", provenance }, ...(staffing ? [{ value: facts.agency, role: "STAFFING_AGENCY" as const, provenance }] : [])],
      externalIdentifiers: [{ provider: input.source.sourceName, identifierType: "PROMAN_REFERENCE", value: facts.reference, provenance }],
    });
  }
}
