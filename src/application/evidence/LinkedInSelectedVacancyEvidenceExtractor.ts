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
  // Internal hiring/equal-opportunity prose is not an agency service claim.
  // In particular, bare "recrutement", "agency" or "outsourcing" is insufficient.
  const staffingTerms = /\b(?:agence\s+d['’](?:int[eé]rim|emploi)|travail\s+temporaire|(?:temporary\s+)?staffing(?:\s+agency)?|employment\s+agency)\b/iu;
  const recruitmentTerms = /\b(?:cabinet\s+de\s+recrutement|agence\s+de\s+recrutement|recruit(?:ment|ing)\s+agency|headhunting|chasse\s+de\s+t[eê]te|executive\s+search|(?:recrute|recrutons|recherche|recherchons)\s+pour\s+(?:(?:le\s+compte\s+de\s+)?(?:notre|son|nos|ses)|un)\s+clients?|recruits?\s+for\s+(?:our|a|its)\s+client)\b/iu;
  const services = /\b(?:sp[eé]cialis[ée]+\s+(?:dans|en)\s+|sp[eé]cialiste\s+(?:du|de)\s+|activit[eé]\s+d['’e]\s*|services?\s+de\s+|speciali[sz]es?\s+in\s+)(?:le\s+|l['’])?(int[eé]rim|interim|recrutement|recruitment|recruiting|staffing)\b/iu;
  for (const match of body.matchAll(brandPattern)) {
    const excerpt = body.slice(
      Math.max(0, match.index - 180),
      Math.min(body.length, match.index + brand.length + 180),
    );
    const service = services.exec(excerpt);
    if (staffingTerms.test(excerpt) || recruitmentTerms.test(excerpt) || service !== null) {
      return staffingTerms.test(excerpt) || /^(?:int[eé]rim|interim|staffing)$/iu.test(service?.[1] ?? "") ? "STAFFING_AGENCY" : "RECRUITMENT_AGENCY";
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
