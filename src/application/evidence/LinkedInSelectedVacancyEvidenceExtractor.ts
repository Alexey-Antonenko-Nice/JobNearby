import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

export class LinkedInSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "LINKEDIN") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const text = observation.evidenceContent.context.text ?? "";
    const header = text.split(/\n[ \t]*À propos de l['’]offre d['’]emploi[ \t]*\n/iu)[0] ?? text;
    const lines = header.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    const title = lines.slice(1).find((line) => /\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m)\b|maintenance|ing[eé]nieur|technicien/iu.test(line));
    const company = lines[0];
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const intermediaryRole = company === undefined
      ? undefined
      : classifyLinkedInIntermediary(text.slice(header.length), company);
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: title, provenance }] }),
      organizations: company === undefined
        ? []
        : [
            { value: company, role: "DISPLAYED_COMPANY" as const, provenance },
            ...(intermediaryRole === undefined
              ? []
              : [{ value: company, role: intermediaryRole, provenance }]),
          ],
    });
  }
}

function classifyLinkedInIntermediary(
  body: string,
  displayedCompany: string,
): "RECRUITMENT_AGENCY" | "STAFFING_AGENCY" | undefined {
  if (
    /\bmanpowergroup\b/iu.test(displayedCompany) &&
    /\b(?:cabinet\s+de\s+recrutement|recherche\s+pour\s+son\s+client)\b/iu.test(body)
  ) {
    return "STAFFING_AGENCY";
  }
  const brand = displayedCompany.split("|")[0]!.trim().split(/\s+/u)[0]!;
  if (brand.length === 0) return undefined;
  const brandPattern = new RegExp(escapeRegExp(brand), "giu");
  const recruitmentTerms = /\b(?:int[eé]rim|recrutement|outsourcing|headhunting|chasse\s+de\s+t[eê]te|executive\s+search)\b/iu;
  const staffingTerms = /\b(?:int[eé]rim|outsourcing)\b/iu;
  for (const match of body.matchAll(brandPattern)) {
    const excerpt = body.slice(
      Math.max(0, match.index - 180),
      Math.min(body.length, match.index + brand.length + 180),
    );
    if (recruitmentTerms.test(excerpt)) {
      return staffingTerms.test(excerpt) ? "STAFFING_AGENCY" : "RECRUITMENT_AGENCY";
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
