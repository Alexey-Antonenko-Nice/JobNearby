import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { adeccoSelectedFacts } from "../acquisition/AdeccoSelectedVacancyContextLocator.js";

export class AdeccoSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    const context = observation.evidenceContent;
    const facts = context.kind === "SELECTED_VACANCY_CONTEXT" && context.context.providerKey === "ADECCO"
      ? adeccoSelectedFacts(context.context.html ?? "") : undefined;
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const terms = [
      ...(facts.contract === "CDI" ? ["INDEFINITE"] : []), ...(facts.contract === "CDD" ? ["FIXED_TERM"] : []),
      ...(/^int[eé]rim$/iu.test(facts.contract ?? "") ? ["INTERIM"] : []),
      ...(/^temps plein$/iu.test(facts.schedule ?? "") ? ["FULL_TIME"] : []),
      ...(/^temps partiel$/iu.test(facts.schedule ?? "") ? ["PART_TIME"] : []),
    ];
    const number = "\\d+(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d{1,2})?";
    const match = new RegExp(`^€\\s*(${number})\\s*[-–]\\s*€\\s*(${number})\\s*/\\s*(Annuel|Mensuel|Heure)$`, "iu").exec(facts.salary ?? "");
    const amount = (value: string) => Number(value.replace(/\s/gu, "").replace(",", "."));
    const salary = match && amount(match[1]!) > 0 && amount(match[2]!) >= amount(match[1]!) ? {
      rawText: facts.salary!, currency: "EUR", minimum: amount(match[1]!), maximum: amount(match[2]!),
      period: /^annuel$/iu.test(match[3]!) ? "YEAR" as const : /^mensuel$/iu.test(match[3]!) ? "MONTH" as const : "HOUR" as const, provenance,
    } : undefined;
    // The named cabinet and recruiting-for-clients wording are explicit in the
    // selected description. The provider hostname alone supplies no agency fact.
    const agency = context.kind === "SELECTED_VACANCY_CONTEXT"
      ? /\b(?:Le\s+)?(Cabinet\s+[\p{Lu}][\p{L} '&’.-]{1,80}?\s+Recrutement)(?:\s+CDD\s*\/\s*CDI)?\s+recrute\s+pour\s+l['’]un\s+de\s+ses\s+clients\b/u.exec(context.context.text ?? "")?.[1]
      : undefined;
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      ...(agency ? { organizations: [{ value: agency, role: "RECRUITMENT_AGENCY", provenance }] } : {}),
      vacancyTitles: [{ value: facts.title, provenance }],
      ...(facts.location ? { locations: [{ value: facts.location, role: "WORKPLACE", provenance }] } : {}),
      ...(terms.length ? { engagements: [{ rawTerms: [facts.contract, facts.schedule].filter((v): v is string => Boolean(v)), normalizedTerms: terms, provenance }] } : {}),
      ...(salary ? { compensations: [salary] } : {}),
      ...(facts.positionCount === undefined ? {} : { positionCounts: [{ rawText: facts.positionCountText!, value: facts.positionCount, provenance }] }),
    });
  }
}
