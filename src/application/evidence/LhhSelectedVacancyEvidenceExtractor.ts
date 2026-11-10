import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { lhhFacts, lhhSalary } from "../acquisition/LhhVacancy.js";

type Provenance = { sourceObservationId: string; extractionMethod: "TEXT_EXTRACTION"; confidence: number; contentOrigin: "SELECTED_VACANCY_CONTEXT" };

export class LhhSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "LHH") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const context = observation.evidenceContent.context;
    const provenance: Provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION", confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" };
    const facts = context.html ? lhhFacts(context.html) : undefined;
    if (!facts) return this.legacy(observation.id, context.text ?? "", provenance);
    // The contract comes only from the selected pane's contract field, never from
    // the agency's business description ("intérim spécialisé").
    const contract = /^cdi$/iu.test(facts.contract) ? "INDEFINITE" : /^cdd$/iu.test(facts.contract) ? "FIXED_TERM" : undefined;
    const pay = facts.salary ? lhhSalary(facts.salary) : undefined;
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      vacancyTitles: [{ value: facts.title, provenance }],
      ...(facts.location ? { locations: [{ value: facts.location, role: "WORKPLACE" as const, provenance }] } : {}),
      engagements: contract ? [{ rawTerms: [facts.contract], normalizedTerms: [contract], provenance }] : [],
      ...(pay ? { compensations: [{ ...pay, provenance }] } : {}),
      organizations: [
        { value: facts.company, role: "DISPLAYED_COMPANY" as const, provenance },
        ...(facts.clientAssignment ? [{ value: facts.company, role: "STAFFING_AGENCY" as const, provenance }] : []),
      ],
    });
  }

  private legacy(sourceObservationId: string, text: string, provenance: Provenance) {
    const staffing = /recherche\s+pour\s+son\s+client/iu.test(text);
    const pay = lhhSalary(text);
    return createExtractedVacancyEvidence({
      sourceObservationId,
      organizations: staffing ? [{ value: "LHH Recruitment Solutions", role: "RECRUITER" as const, provenance }, { value: "LHH Recruitment Solutions", role: "STAFFING_AGENCY" as const, provenance }] : [],
      compensations: pay ? [{ ...pay, rawText: /€[^/]*\/\s*\w+/u.exec(text)?.[0] ?? pay.rawText, provenance }] : [],
    });
  }
}
