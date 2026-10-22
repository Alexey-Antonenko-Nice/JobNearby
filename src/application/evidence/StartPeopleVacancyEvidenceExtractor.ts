import type { VacancyEngagementEvidence } from "../../domain/evidence/VacancyEngagementEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { startPeopleFacts } from "../acquisition/StartPeopleVacancy.js";

export class StartPeopleVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "START_PEOPLE" ? selected.context : undefined;
    const facts = context?.html ? startPeopleFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const rawContract = facts.values["Contrat"]!;
    const contracts = [ ["INDEFINITE", /\bCDI\b/iu], ["FIXED_TERM", /\bCDD\b/iu], ["INTERIM", /\bint[eé]rim\b/iu] ] as const;
    const hours = [ ["FULL_TIME", /\btemps plein\b/iu], ["PART_TIME", /\btemps partiel\b/iu] ] as const;
    const visible = [rawContract, facts.description, facts.profile].join("\n");
    const visibleHours = hours.filter(([, pattern]) => pattern.test(visible)).map(([term]) => term);
    const structuredHours = Array.isArray(context?.metadata?.structuredEmploymentTypes) ? context.metadata.structuredEmploymentTypes.filter((value): value is "FULL_TIME" | "PART_TIME" => value === "FULL_TIME" || value === "PART_TIME") : [];
    const engagements: VacancyEngagementEvidence[] = contracts.filter(([, pattern]) => pattern.test(rawContract)).map(([term]) => ({ rawTerms: [rawContract], normalizedTerms: [term], provenance }));
    for (const term of visibleHours) engagements.push({ rawTerms: [term === "FULL_TIME" ? "Temps plein (vacancy)" : "Temps partiel (vacancy)"], normalizedTerms: [term], provenance });
    for (const term of structuredHours) engagements.push({ rawTerms: [`JobPosting[${context!.providerExternalId}].employmentType=${term}`], normalizedTerms: [term], provenance: { ...provenance, extractionMethod: "DIRECT_FIELD" } });
    const salary = facts.values["Rémunération"] ?? "";
    const pay = /^entre\s+(\d+(?:[.,]\d{1,2})?)\s+et\s+(\d+(?:[.,]\d{1,2})?)\s*€\s*\/\s*(an|mois|heure)$/iu.exec(salary);
    const amount = (value: string) => Number(value.replace(",", "."));
    const period = pay?.[3]?.toLowerCase();
    const name = facts.values["Votre agence"]!;
    // Agency label plus this vacancy's client relationship; generic agency words alone do not classify.
    const intermediary = /\bnotre client\b[^.!?\n]{0,300}\b(?:recherche|recheche|recrute)\b/iu.test(facts.description);
    const experienceText = [facts.values["Expérience"] ?? "", facts.profile].join("\n");
    const ranges = [...experienceText.matchAll(/(?:Expérience\s+de\s+)?(\d+)\s*(?:-|à)\s*(\d+)\s+ans(?:\s+minimum)?/giu)];
    // Do not reinterpret the upper endpoint of a range as a separate minimum.
    const remainder = ranges.reduce((value, match) => value.replace(match[0], " ".repeat(match[0].length)), experienceText);
    const minimums = [...remainder.matchAll(/(\d+)\s+ans\s+minimum/giu)];
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.values["Localisation"]!, role: "WORKPLACE", provenance }], engagements,
      ...(pay && Number.isFinite(amount(pay[1]!)) && Number.isFinite(amount(pay[2]!)) && amount(pay[2]!) >= amount(pay[1]!) ? { compensations: [{ rawText: salary, currency: "EUR", minimum: amount(pay[1]!), maximum: amount(pay[2]!), period: period === "an" ? "YEAR" : period === "mois" ? "MONTH" : "HOUR", provenance }] } : {}),
      organizations: [{ value: name, role: "DISPLAYED_COMPANY", provenance }, ...(intermediary ? [{ value: name, role: "STAFFING_AGENCY" as const, provenance }] : [])],
      experienceRequirements: [...ranges.filter(match => Number.isFinite(Number(match[2])) && Number(match[2]) >= Number(match[1])).map(match => ({ rawText: match[0], minimumYears: Number(match[1]), maximumYears: Number(match[2]), unit: "YEAR" as const, provenance })),
        ...minimums.filter(match => Number.isFinite(Number(match[1]))).map(match => ({ rawText: match[0], minimumYears: Number(match[1]), unit: "YEAR" as const, provenance }))],
    });
  }
}
