import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { randstadFacts } from "../acquisition/RandstadVacancy.js";

export class RandstadVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "RANDSTAD" ? selected.context : undefined;
    const facts = context?.html ? randstadFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const structured = context?.metadata?.matchedJobPosting as Record<string, unknown> | undefined;
    const contract = /^cdi$/iu.test(facts.contract ?? "") ? "INDEFINITE" : /^cdd$/iu.test(facts.contract ?? "") ? "FIXED_TERM" : /^int[eé]rim$/iu.test(facts.contract ?? "") ? "INTERIM" : undefined;
    const hours = structured?.employmentType === "FULL_TIME" || structured?.employmentType === "PART_TIME" ? structured.employmentType : undefined;
    const salary = /^(\d+(?:[ \u00a0\u202f]\d{3})*)\s*€(?:\s*[-–]\s*(\d+(?:[ \u00a0\u202f]\d{3})*)\s*€)?\s+par\s+(ann[ée]e|mois|heure)$/iu.exec(facts.salary ?? "");
    const amount = (value: string) => Number(value.replace(/\s/gu, ""));
    const experience = /^(\d+)\s+ann[ée]e(?:\(s\)|s)?$/iu.exec(facts.experience ?? "");
    const agency = typeof structured?.organizationName === "string" && /^randstad(?:\s+france)?$/iu.test(structured.organizationName) ? structured.organizationName : undefined;
    // Recruiting for a client is a vacancy relationship, not proof of a staffing assignment.
    // Neither the company's name/activity nor CDI establishes that relationship.
    const recruitingForClient = /\bnous\s+(?:recherchons|recrutons)\s+pour\s+(?:le\s+compte\s+de\s+)?notre\s+client\b/iu.test(context?.text ?? "");
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }],
      engagements: [ ...(contract ? [{ rawTerms: [facts.contract!], normalizedTerms: [contract], provenance }] : []),
        ...(hours ? [{ rawTerms: [`JobPosting.employmentType=${hours}`], normalizedTerms: [hours], provenance: { ...provenance, extractionMethod: "DIRECT_FIELD" as const } }] : []) ],
      ...(salary && amount(salary[2] ?? salary[1]!) >= amount(salary[1]!) ? { compensations: [{ rawText: facts.salary!, currency: "EUR", minimum: amount(salary[1]!), maximum: amount(salary[2] ?? salary[1]!),
        period: /^ann/iu.test(salary[3]!) ? "YEAR" as const : salary[3]!.toLowerCase() === "mois" ? "MONTH" as const : "HOUR" as const, provenance }] } : {}),
      ...(experience ? { experienceRequirements: [{ rawText: facts.experience!, minimumYears: Number(experience[1]), unit: "YEAR", provenance }] } : {}),
      ...(agency ? { organizations: [{ value: agency, role: "DISPLAYED_COMPANY", provenance: { ...provenance, extractionMethod: "DIRECT_FIELD" as const } },
        ...(recruitingForClient ? [{ value: agency, role: "RECRUITMENT_AGENCY" as const, provenance: { ...provenance, confidence: 0.98 } }] : [])] } : {}),
    });
  }
}
