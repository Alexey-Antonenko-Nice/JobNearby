import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { haysFacts, haysSalary } from "../acquisition/HaysVacancy.js";

export class HaysVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "HAYS" ? selected.context : undefined;
    const facts = context?.html ? haysFacts(context.html) : undefined;
    if (!facts || !context?.providerExternalId) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const { type, flexible, location, salary } = facts.values;
    const contract = /^(?:permanent|cdi)$/iu.test(type) ? "INDEFINITE" : undefined;
    // "Mode de travail: Full-Time" is working time, never a remote/hybrid/on-site mode.
    const hours = /^full[- ]time$/iu.test(flexible) ? "FULL_TIME" : /^part[- ]time$/iu.test(flexible) ? "PART_TIME" : undefined;
    const pay = salary ? haysSalary(salary) : undefined;
    return createExtractedVacancyEvidence({
      sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }],
      ...(location ? { locations: [{ value: location, role: "WORKPLACE" as const, provenance }] } : {}),
      engagements: [
        ...(contract ? [{ rawTerms: [type], normalizedTerms: [contract], provenance }] : []),
        ...(hours ? [{ rawTerms: [flexible], normalizedTerms: [hours], provenance }] : [])
      ],
      ...(pay ? { compensations: [{ ...pay, provenance }] } : {}),
      organizations: [
        { value: facts.company, role: "DISPLAYED_COMPANY" as const, provenance },
        // Contextual, not explicit: employer wording is vacancy-level evidence that
        // the human role review can still override; client wording flips it.
        ...(facts.clientAssignment ? [{ value: facts.company, role: "STAFFING_AGENCY" as const, provenance }]
          : facts.directEmployer ? [{ value: facts.company, role: "EMPLOYER" as const, provenance: { ...provenance, confidence: 0.98 } }] : [])
      ]
    });
  }
}
