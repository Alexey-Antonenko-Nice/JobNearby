import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { normalizeVacancyEvidenceInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { manpowerFacts } from "../acquisition/ManpowerVacancy.js";

export class ManpowerVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const context = normalizeVacancyEvidenceInput(input).evidenceContent;
    const facts = context.kind === "SELECTED_VACANCY_CONTEXT" && context.context.providerKey === "MANPOWER"
      ? manpowerFacts(context.context.html ?? "") : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const terms = [ ...(/^temporary$/iu.test(facts.contract ?? "") ? ["INTERIM"] : []),
      ...(/^full time$/iu.test(facts.hours ?? "") ? ["FULL_TIME"] : []), ...(/^part time$/iu.test(facts.hours ?? "") ? ["PART_TIME"] : []) ];
    const pay = /^\$\s*(\d+(?:\.\d{1,2})?)(?:\s*[-–]\s*\$?\s*(\d+(?:\.\d{1,2})?))?(?:\s*(?:\/|per)\s*(hour|month|year))?$/iu.exec(facts.salary ?? "");
    const period = pay?.[3]?.toUpperCase() as "HOUR" | "MONTH" | "YEAR" | undefined;
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }],
      ...(terms.length ? { engagements: [{ rawTerms: [facts.contract, facts.hours].filter((v): v is string => Boolean(v)), normalizedTerms: terms, provenance }] } : {}),
      ...(pay && (pay[2] === undefined || Number(pay[2]) >= Number(pay[1])) ? { compensations: [{ rawText: facts.salary!, currency: "USD", minimum: Number(pay[1]),
        ...(pay[2] === undefined ? {} : { maximum: Number(pay[2]) }), ...(period ? { period } : {}), provenance }] } : {}),
      ...(facts.agency ? { organizations: [{ value: facts.agency, role: "RECRUITMENT_AGENCY", provenance }] } : {}),
      ...(facts.recruiter ? { people: [{ value: facts.recruiter, role: "RECRUITER", provenance }] } : {}),
      // This is the vacancy's industry label; no named employer is inferred.
      ...(facts.industry ? { employerCharacteristics: [{ value: facts.industry, category: "INDUSTRY", specificity: "LOW", provenance }] } : {}),
    });
  }
}
