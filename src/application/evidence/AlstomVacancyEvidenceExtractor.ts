import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { alstomFacts } from "../acquisition/AlstomVacancy.js";
export class AlstomVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "ALSTOM" ? selected.context : undefined;
    const facts = context?.html ? alstomFacts(context.html) : undefined;
    if (!facts || !context?.providerExternalId) return createExtractedVacancyEvidence({
      sourceObservationId: input.id
    });
    const provenance = {
      sourceObservationId: input.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: 1,
      contentOrigin: "SELECTED_VACANCY_CONTEXT" as const
    };
    const labeled = (label: string) => {
      const values = [...facts.description.matchAll(new RegExp(`^${label}:\\s*([^\\n]+)$`, "gmi"))];
      return values.length === 1 ? values[0]![1]!.trim() : undefined;
    };
    const modeText = labeled("Work mode");
    const mode = /^remote$/iu.test(modeText ?? "") ? "REMOTE" : /^hybrid$/iu.test(modeText ?? "") ? "HYBRID" : /^on[- ]site$/iu.test(modeText ?? "") ? "ON_SITE" : undefined;
    const employmentText = labeled("Employment type");
    const engagement = /^full[- ]time$/iu.test(employmentText ?? "") ? "FULL_TIME" : /^part[- ]time$/iu.test(employmentText ?? "") ? "PART_TIME" : undefined;
    const salary = labeled("Salary");
    const pay = /^(\d+(?:\.\d{1,2})?)(?:\s*[-–]\s*(\d+(?:\.\d{1,2})?))?\s+(EUR|USD|GBP)(?:\s*\/\s*(year|month|hour))?$/iu.exec(salary ?? "");
    const period = pay?.[4]?.toLowerCase();
    const validPay = pay && Number.isFinite(Number(pay[1])) && (pay[2] === undefined || Number.isFinite(Number(pay[2])) && Number(pay[2]) >= Number(pay[1]));
    // Experienced/real-time software/customer sites are not contract or work-mode labels.
    return createExtractedVacancyEvidence({
      sourceObservationId: input.id,
      vacancyTitles: [{
        value: facts.title,
        provenance
      }],
      locations: [{
        value: facts.location,
        role: "WORKPLACE",
        provenance
      }],
      ...(mode ? {
        workModes: [{
          value: mode,
          provenance
        }]
      } : {}),
      ...(engagement ? {
        engagements: [{
          rawTerms: [employmentText!],
          normalizedTerms: [engagement],
          provenance
        }]
      } : {}),
      ...(validPay ? {
        compensations: [{
          rawText: salary!,
          currency: pay[3]!.toUpperCase(),
          minimum: Number(pay[1]),
          ...(pay[2] !== undefined ? {
            maximum: Number(pay[2])
          } : {}),
          ...(period ? {
            period: period === "year" ? "YEAR" as const : period === "month" ? "MONTH" as const : "HOUR" as const
          } : {}),
          provenance
        }]
      } : {}),
      organizations: [{
        value: facts.company,
        role: "DISPLAYED_COMPANY",
        provenance
      }, ...(facts.directEmployer ? [{
        value: facts.company,
        role: "EMPLOYER" as const,
        provenance: {
          ...provenance,
          confidence: 0.98
        }
      }] : [])],
      externalIdentifiers: [{
        value: context.providerExternalId,
        provider: input.source.sourceName,
        identifierType: "URL_POSTING_ID",
        provenance
      }, {
        value: facts.requisitionId,
        provider: input.source.sourceName,
        identifierType: "REQUISITION_ID",
        provenance
      }]
    });
  }
}
