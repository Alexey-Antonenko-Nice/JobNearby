import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { actualFacts } from "../acquisition/ActualVacancy.js";
import { randstadText } from "../acquisition/RandstadVacancy.js";

export class ActualVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const context = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "ACTUAL" ? selected.context : undefined;
    const facts = context?.html ? actualFacts(context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const contract = /^CDI$/iu.test(facts.contract) ? "INDEFINITE" : /^CDD$/iu.test(facts.contract) ? "FIXED_TERM" : "INTERIM";
    const jobText = randstadText(facts.job);
    const schedule = facts.schedule ?? (/\btemps plein\b/iu.test(jobText) ? "Temps plein (Le poste)" : /\btemps partiel\b/iu.test(jobText) ? "Temps partiel (Le poste)" : undefined);
    const hours = /^temps plein\b/iu.test(schedule ?? "") ? "FULL_TIME" : /^temps partiel\b/iu.test(schedule ?? "") ? "PART_TIME" : undefined;
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const role = normalize(facts.title.replace(/\(?[hf]\s*\/\s*[hf]\)?/giu, "").trim());
    const counts = [...jobText.matchAll(/\bnous\s+recrutons\s+([1-9]\d*)\s+([^\n.!?]{2,160})/giu)]
      .filter(match => { const candidate = normalize(match[2]!); return candidate.startsWith(role) && /^(?:s)?(?:\s|$)/u.test(candidate.slice(role.length)); });
    const count = counts.length > 0 && new Set(counts.map(match => match[1])).size === 1 ? Number(counts[0]![1]) : undefined;
    const staffing = /\bagence\s+d['’]int[eé]rim\b/iu.test(facts.agencyDescription);
    const recruiting = /\brecrutons\b[^.!?\n]{0,180}\bpour\s+l['’]un\s+de\s+nos\s+clients?\b/iu.test(jobText);
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }],
      engagements: [{ rawTerms: [facts.contract, ...(schedule ? [schedule] : [])], normalizedTerms: [contract, ...(hours ? [hours] : [])], provenance }],
      organizations: [{ value: facts.name, role: "DISPLAYED_COMPANY", provenance },
        ...(staffing || recruiting ? [{ value: facts.name, role: staffing ? "STAFFING_AGENCY" as const : "RECRUITMENT_AGENCY" as const, provenance }] : [])],
      ...(count !== undefined && Number.isSafeInteger(count) ? { positionCounts: [{ value: count, rawText: counts[0]![0], provenance }] } : {}),
    });
  }
}
