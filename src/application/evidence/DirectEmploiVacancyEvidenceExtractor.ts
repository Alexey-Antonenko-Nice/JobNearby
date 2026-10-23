import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { directEmploiFacts } from "../acquisition/DirectEmploiVacancy.js";

const plain = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

export class DirectEmploiVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "DIRECT_EMPLOI" ? selected.context : undefined;
    const facts = context?.html ? directEmploiFacts(context.html) : undefined;
    const postingId = context?.providerExternalId;
    if (!facts || !postingId) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const record = context?.metadata?.matchedJobPosting;
    const structuredType = record !== null && typeof record === "object" ? (record as Record<string, unknown>).employmentType : undefined;
    // The badge and the matched JSON-LD describe the same posting; both original terms stay together as one compatible engagement.
    const terms: { raw: string; normalized: string }[] = [];
    if (facts.contract && /^int[ée]rim$/iu.test(facts.contract)) terms.push({ raw: facts.contract, normalized: "INTERIM" });
    else if (facts.contract && /^(?:temporary|temporaire)$/iu.test(facts.contract)) terms.push({ raw: facts.contract, normalized: "TEMPORARY" });
    if (typeof structuredType === "string" && structuredType.trim().toUpperCase() === "TEMPORARY") terms.push({ raw: structuredType.trim(), normalized: "TEMPORARY" });
    const normalizedTerms = [...new Set(terms.map(term => term.normalized))];
    // Only explicit intermediary wording marks the displayed company as a staffing agency. TEMPORARY alone never does.
    const agency = facts.company !== undefined && (normalizedTerms.includes("INTERIM") || /\brecherche\s+pour\s+(?:son|un)\s+client\b/iu.test(plain(facts.description)));
    return createExtractedVacancyEvidence({
      sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }],
      ...(facts.location ? { locations: [{ value: facts.location, role: "WORKPLACE" as const, provenance }] } : {}),
      ...(terms.length ? { engagements: [{ rawTerms: terms.map(term => term.raw), normalizedTerms, provenance }] } : {}),
      ...(facts.company ? { organizations: [
        { value: facts.company, role: "DISPLAYED_COMPANY" as const, provenance },
        ...(agency ? [{ value: facts.company, role: "STAFFING_AGENCY" as const, provenance }] : []),
      ] } : {}),
      externalIdentifiers: [
        { value: postingId, provider: input.source.sourceName, identifierType: "DIRECT_EMPLOI_POSTING_ID", provenance },
        ...(facts.reference ? [{ value: facts.reference, provider: input.source.sourceName, identifierType: "DIRECT_EMPLOI_REFERENCE", provenance }] : []),
      ],
    });
  }
}
