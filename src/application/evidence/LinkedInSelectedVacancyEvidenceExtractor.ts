import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { normalizeVacancyEvidenceInput, type VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";

export class LinkedInSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput) {
    const observation = normalizeVacancyEvidenceInput(input);
    if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT" || observation.evidenceContent.context.providerKey !== "LINKEDIN") return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    const text = observation.evidenceContent.context.text ?? "";
    // A pane scrolled to the description starts at the section heading and has no header at all.
    const header = /^\s*À propos de l['’]offre d['’]emploi\s*(?:\n|$)/iu.test(text) || SECTION_LABEL.test(text.split("\n", 1)[0]!.trim())
      ? ""
      : text.split(/\n[ \t]*À propos de l['’]offre d['’]emploi[ \t]*\n/iu)[0] ?? text;
    const lines = header.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    const structural = selectedHeaderFacts(lines, observation.evidenceContent.context.html, observation.evidenceContent.context.providerExternalId);
    const title = structural?.title ?? lines.slice(1).find((line) => isTitleLine(line));
    const company = lines[0] !== undefined && isCompanyLine(lines[0]) ? lines[0] : undefined;
    const provenance = { sourceObservationId: observation.id, extractionMethod: "TEXT_EXTRACTION" as const, confidence: 1, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const intermediaryRole = company === undefined
      ? undefined
      : classifyLinkedInIntermediary(text.slice(header.length), company);
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: title, provenance }] }),
      ...(structural?.location === undefined ? {} : { locations: [{ value: structural.location, role: "WORKPLACE" as const, provenance }] }),
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

const SECTION_LABEL = /^(?:à\s+propos\b.*|about\s+(?:the\s+)?(?:job|company|us)\b.*|description(?:\s+du\s+poste)?|d[ée]tails?\s+de\s+l['’]offre.*|job\s+description|company\s+description|en\s+savoir\s+plus|plus\s+d['’]informations)$/iu;
const PROSE = /[.!?…:;]\s*$|\b(?:nous|vous|notre|nos|votre|vos|we|you|our|your)\b/iu;

function isCompanyLine(line: string): boolean {
  return line.length <= 120 && !SECTION_LABEL.test(line) && !/[!?…:;]\s*$/u.test(line) && line.split(/\s+/u).length <= 12;
}

// A fallback title is a short header line, never a sentence or a section label.
function isTitleLine(line: string): boolean {
  return line.length <= 150 && !SECTION_LABEL.test(line) && !PROSE.test(line) &&
    /\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m)\b|maintenance|ing[eé]nieur|technicien/iu.test(line);
}

const HEADER_METADATA = /\b(?:postuler|candidat\w*|enregistrer|republication|republi[eé]e?|il\s+y\s+a|personnes?|promu|applicants?|reposted|clicked|ago)\b/iu;

/**
 * The validated header is company, then the title link for the selected job, then
 * "location · posting age · applicants". The title must be the unique link to the
 * selected job ID so a sibling card or recommendation cannot supply it.
 */
function selectedHeaderFacts(
  lines: readonly string[],
  html: string | undefined,
  externalId: string | undefined,
): { readonly title: string; readonly location?: string } | undefined {
  if (html === undefined || externalId === undefined || !/^\d+$/u.test(externalId)) return undefined;
  const headerHtml = html.split(/[ÀA] propos de l(?:'|’|&#x27;|&#39;|&rsquo;)offre d(?:'|’|&#x27;|&#39;|&rsquo;)emploi/iu)[0] ?? html;
  const titles = new Set<string>();
  for (const anchor of headerHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = /\bhref=["']([^"']*)["']/iu.exec(anchor[1]!)?.[1] ?? "";
    if (!new RegExp(`/jobs/view/${externalId}(?:[/?#&]|$)`, "u").test(href.replace(/&amp;/gu, "&"))) continue;
    const text = decodeText(anchor[2]!.replace(/<[^>]*>/gu, ""));
    if (text.length > 0) titles.add(text);
  }
  if (titles.size !== 1) return undefined;
  const title = [...titles][0]!;
  const index = lines.indexOf(title);
  if (index < 1 || title.length > 200) return undefined;
  const location = (lines[index + 1] ?? "").split("·")[0]!.trim();
  const plausible = location.length >= 2 && location.length <= 120 && /\p{L}/u.test(location) &&
    (lines[index + 1]!.includes("·") || location.includes(",")) && !HEADER_METADATA.test(location) &&
    !/[€$£]|\d{3}/u.test(location);
  return { title, ...(plausible ? { location } : {}) };
}

function decodeText(value: string): string {
  return value
    .replace(/&nbsp;/gu, " ").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"").replace(/&#0?39;|&#x27;|&apos;|&rsquo;/gu, "'").replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ").trim();
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
