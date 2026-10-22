import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { synergieFacts } from "../acquisition/SynergieVacancy.js";

export function parseSynergieSalary(rawText: string) {
  const amount = "\\d+(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d{1,2})?";
  const match = new RegExp(`^(${amount})(?:\\s*[-–]\\s*(${amount}))?\\s*(K)?€(?:\\s*(?:par\\s+|/\\s*)(an|ann[ée]e|mois|heure))?$`, "iu").exec(rawText);
  if (!match) return undefined;
  const value = (v: string) => Number(v.replace(/\s/gu, "").replace(",", ".")) * (match[3] ? 1000 : 1);
  const minimum = value(match[1]!);
  const maximum = match[2] === undefined ? undefined : value(match[2]);
  if (!Number.isFinite(minimum) || (maximum !== undefined && (!Number.isFinite(maximum) || maximum < minimum))) return undefined;
  const period = match[4] === undefined ? undefined : /^an/iu.test(match[4]) ? "YEAR" as const : /^mois$/iu.test(match[4]) ? "MONTH" as const : "HOUR" as const;
  return { rawText, currency: "EUR", minimum, ...(maximum === undefined ? {} : { maximum }), ...(period ? { period } : {}) };
}
export class SynergieVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "SYNERGIE" ? selected.context : undefined;
    const facts = context?.html ? synergieFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const salary = parseSynergieSalary(facts.values["Salaire"] ?? "");
    const base = context?.metadata?.matchedBaseSalary as { currency?: string; value?: { minValue?: unknown; maxValue?: unknown; unitText?: unknown } } | undefined;
    const structuredPeriod = base?.currency === "EUR" && salary && salary.period === undefined && Number(base.value?.minValue) === salary.minimum
      && (salary.maximum === undefined || Number(base.value?.maxValue) === salary.maximum)
      && ["YEAR", "MONTH", "HOUR"].includes(String(base.value?.unitText)) ? base.value!.unitText as "YEAR" | "MONTH" | "HOUR" : undefined;
    const contract = facts.values["Type de contrat"];
    const term = /^int[eé]rim$/iu.test(contract ?? "") ? "INTERIM" : /^cdi$/iu.test(contract ?? "") ? "INDEFINITE" : /^cdd$/iu.test(contract ?? "") ? "FIXED_TERM" : undefined;
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.values["Lieu de la mission"]!, role: "WORKPLACE", provenance }],
      ...(term ? { engagements: [{ rawTerms: [contract!], normalizedTerms: [term], provenance }] } : {}),
      ...(salary ? { compensations: [{ ...salary, ...(structuredPeriod ? { period: structuredPeriod } : {}), provenance }] } : {}),
    });
  }
}
