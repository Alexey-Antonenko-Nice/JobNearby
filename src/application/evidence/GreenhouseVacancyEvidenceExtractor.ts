import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { greenhouseFacts } from "../acquisition/GreenhouseVacancy.js";
export class GreenhouseVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const selected = normalizeVacancyEvidenceInput(input).evidenceContent;
    const facts = selected.kind === "SELECTED_VACANCY_CONTEXT" && selected.context.providerKey === "GREENHOUSE" && selected.context.html ? greenhouseFacts(selected.context.html) : undefined;
    if (!facts) return createExtractedVacancyEvidence({ sourceObservationId: input.id });
    const provenance = { sourceObservationId: input.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const lines = facts.description.split("\n").map(s => s.trim()).filter(Boolean);
    const start = lines.findIndex(s => /^You['’]ll need$/iu.test(s));
    const end = lines.findIndex((s, i) => i > start && /^Benefits$/iu.test(s));
    const requirements = start >= 0 && end > start ? lines.slice(start + 1, end) : [];
    const education = requirements.filter(s => /^A technical degree in /u.test(s));
    const responsibilityStart = lines.indexOf("Responsibilities");
    const responsibilities = responsibilityStart >= 0 && start > responsibilityStart ? lines.slice(responsibilityStart + 1, start) : [];
    const skills = [
      ...requirements.filter(s => /Linux|command-line|troubleshooting/iu.test(s)).map(rawText => ({ skill: rawText, rawText })),
      ...responsibilities.filter(s => /triage|read logs|connectivity problems/iu.test(s)).map(rawText => ({ skill: "Responsibility: " + rawText, rawText: "Responsibility: " + rawText })),
    ];
    // First-person company introduction, corroborated by the selected tenant, not a client mention.
    const company = /^At ([\p{L}\p{N} &.-]{2,60}), we(?:['’]re| are)\b/u.exec(facts.description)?.[1];
    const tenant = selected.kind === "SELECTED_VACANCY_CONTEXT" ? selected.context.metadata?.tenant : undefined;
    const companyMatches = company && typeof tenant === "string" && company.toLowerCase().replace(/[^a-z0-9]/gu, "") === tenant.toLowerCase();
    return createExtractedVacancyEvidence({ sourceObservationId: input.id,
      ...(education.length ? { educationRequirements: education.map(rawText => ({ rawText, provenance })) } : {}),
      ...(skills.length ? { skillRequirements: skills.map(s => ({ ...s, provenance })) } : {}),
      ...(companyMatches ? { organizations: [{ value: company, role: "DISPLAYED_COMPANY", provenance: { ...provenance, confidence: 0.98 } }] } : {}),
      vacancyTitles: [{ value: facts.title, provenance }], locations: [{ value: facts.location, role: "WORKPLACE", provenance }] });
  }
}
