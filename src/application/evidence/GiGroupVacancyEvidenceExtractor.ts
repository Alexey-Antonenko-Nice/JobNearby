import type { VacancyEngagementEvidence } from "../../domain/evidence/VacancyEngagementEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyCompensationEvidence } from "../../domain/evidence/VacancyCompensationEvidence.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { giGroupFacts } from "../acquisition/GiGroupVacancy.js";

function salaryRange(value: string): { minimum: number; maximum: number; period?: "HOUR" | "MONTH" | "YEAR" } | undefined {
  const number = "(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?";
  const match = new RegExp(`^(${number})\\s*€\\s*(?:à|[-–])\\s*(${number})\\s*€((?:\\s+bruts?|\\s+nets?)?(?:\\s*(?:/|par)\\s*(?:h|heure|mois|an)|\\s+(?:mensuels?|annuels?|horaires?))?(?:\\s*\\(base\\s+\\d+\\s+heures?\\))?)$`, "iu").exec(value);
  if (!match) return undefined;
  const amount = (raw: string) => Number(raw.replace(/[ \u00a0\u202f]/gu, "").replace(",", "."));
  const minimum = amount(match[1]!), maximum = amount(match[2]!);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) return undefined;
  const suffix = match[3]!;
  const period = /(?:\/|par)\s*(?:h|heure)\b|\bhoraire/iu.test(suffix) ? "HOUR" : /(?:\/|par)\s*mois\b|\bmensuel/iu.test(suffix) ? "MONTH" : /(?:\/|par)\s*an\b|\bannuel/iu.test(suffix) ? "YEAR" : undefined;
  return { minimum, maximum, ...(period ? { period } : {}) };
}
export class GiGroupVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "GI_GROUP" ? selected.context : undefined;
    const facts = context?.html ? giGroupFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const hours = /^Temps plein$/iu.test(facts.schedule ?? "") ? "FULL_TIME" : /^Temps partiel$/iu.test(facts.schedule ?? "") ? "PART_TIME" : undefined;
    const contracts = [ ["INDEFINITE", /^CDI$/iu], ["FIXED_TERM", /^CDD$/iu], ["INTERIM", /^Intérim$/iu] ] as const;
    const engagements: VacancyEngagementEvidence[] = contracts.flatMap(([term, pattern]) => {
      const rawTerms = [facts.contract, facts.values["Type de contrat"]].filter((value): value is string => value !== undefined && pattern.test(value));
      return rawTerms.length ? [{ rawTerms: [...new Set([...rawTerms, ...(hours ? [facts.schedule!] : [])])], normalizedTerms: [term, ...(hours ? [hours] : [])], provenance }] : [];
    });
    if (!engagements.length && hours) engagements.push({ rawTerms: [facts.schedule!], normalizedTerms: [hours], provenance });
    const rawSalary = facts.values["Rémunération"];
    const pay = rawSalary ? salaryRange(rawSalary) : undefined;
    const compensations: VacancyCompensationEvidence[] = pay ? [{ rawText: rawSalary!, currency: "EUR", ...pay, provenance }] : [];
    const structured = context?.metadata?.structuredPay as { minimum?: number; maximum?: number; period?: string } | undefined;
    if (pay && structured?.minimum === pay.minimum && structured.maximum === pay.maximum && ["HOUR", "MONTH", "YEAR"].includes(structured.period ?? "")) compensations.push({
      rawText: `JobPosting[${context!.providerExternalId}].baseSalary: EUR ${pay.minimum}–${pay.maximum} / ${structured.period}`, currency: "EUR", minimum: pay.minimum, maximum: pay.maximum,
      period: structured.period as "HOUR" | "MONTH" | "YEAR", provenance: { ...provenance, extractionMethod: "DIRECT_FIELD" } });
    const name = typeof context?.metadata?.organizationName === "string" ? context.metadata.organizationName : undefined;
    // Provider staffing semantics apply to its explicitly identified organization;
    // a different hiring organization is not automatically a staffing agency.
    const providerOrganization = name !== undefined && /^Gi Group(?: SpA)?$/iu.test(name);
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }], engagements, compensations,
      ...(name ? { organizations: [{ value: name, role: "DISPLAYED_COMPANY", provenance: { ...provenance, extractionMethod: "DIRECT_FIELD" } },
        ...(providerOrganization ? [{ value: name, role: "STAFFING_AGENCY" as const, provenance }] : [])] } : {}),
    });
  }
}
