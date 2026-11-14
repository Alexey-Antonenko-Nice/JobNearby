import { randstadText } from "./RandstadVacancy.js";
import { KELLY_WORKDAY_HOST } from "./KellyWorkdayVacancy.js";
import { RENAULT_WORKDAY_HOST } from "./RenaultWorkdayVacancy.js";
import { createAcquisitionContext, type AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { HostnameAcquisitionProviderRecognizer } from "./HostnameAcquisitionProviderRecognizer.js";
import { extractWorkdayStructuredFields, extractWorkdayVacancyId, isWorkdaySource } from "./WorkdayVacancy.js";
import { alstomElements } from "./AlstomVacancy.js";

export function requiresGenericWorkdayScope(sourceName: string, sourceUrl: string): boolean {
  return sourceName.endsWith(".myworkdayjobs.com")
    && sourceName !== KELLY_WORKDAY_HOST && sourceName !== RENAULT_WORKDAY_HOST
    && new HostnameAcquisitionProviderRecognizer().recognize({ sourceName, sourceUrl }) === undefined;
}

export function isGenericWorkdaySource(sourceName: string, sourceUrl: string): boolean {
  return requiresGenericWorkdayScope(sourceName, sourceUrl) && isWorkdaySource(sourceName, sourceUrl);
}

const automationId = (open: string) => /\sdata-automation-id=["']([^"']+)["']/iu.exec(open)?.[1];
const elements = (html: string, id: string) => alstomElements(html, open => automationId(open) === id);
const hidden = (html: string) => /\s+hidden(?:\s|=|>)|\baria-hidden\s*=\s*(?:"true"|'true'|true\b)|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(html);
const text = (html: string) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
const ids = (html: string) => text(html).match(/\bJR-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/giu)?.map(id => id.toUpperCase()) ?? [];

/**
 * Existing direct layouts only: the unique header contains its reference, or its
 * next element sibling is the matching requisitionId/subtitle. Never cross a
 * closing parent tag, intervening element or unrelated text to find a reference.
 */
export function locateGenericWorkdayContext(input: {
  sourceName: string; sourceUrl: string; html: string; externalId?: string;
}): AcquisitionContext | undefined {
  const id = extractWorkdayVacancyId(input.sourceUrl);
  if (!isGenericWorkdaySource(input.sourceName, input.sourceUrl) || id === undefined
    || !/^https?:/iu.test(input.sourceUrl)
    || input.externalId !== undefined && input.externalId !== id) return undefined;
  const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
  const headers = elements(clean, "jobPostingHeader");
  const headerOpens = [...clean.matchAll(/<[a-z][\w-]*\b[^>]*>/giu)]
    .filter(match => automationId(match[0]) === "jobPostingHeader");
  if (headers.length !== 1 || headerOpens.length !== 1) return undefined;
  const header = headers[0]!;
  if (hidden(header) || alstomElements(clean, open => hidden(open)).some(region => region.includes(header))) return undefined;
  const titles = elements(header, "jobTitle");
  if (!(titles.length === 1 || titles.length === 0 && /^<h[12]\b/iu.test(header))) return undefined;
  // Page-wide inspection here is a veto only, never a source of field evidence.
  const references = [...elements(clean, "requisitionId"), ...elements(clean, "subtitle")]
    .filter(region => ids(region).length > 0);
  if (references.length !== 1 || ids(references[0]!).length !== 1 || ids(references[0]!)[0] !== id
    || hidden(references[0]!)) return undefined;
  const reference = references[0]!;
  let region = header;
  if (!header.includes(reference)) {
    const after = clean.slice(clean.indexOf(header) + header.length).trimStart();
    if (!after.startsWith(reference)) return undefined;
    region += "\n" + reference;
  }
  if (ids(region).some(value => value !== id)) return undefined;
  // Competing detail regions, even without a second header, cannot establish ownership.
  if (elements(clean, "jobPostingDescription").length > 1 || elements(clean, "jobDetails").length > 1) return undefined;
  for (const field of ["jobTitle", "company", "jobCompany", "headerTitle", "locations", "timeType"]) {
    if (elements(region, field).length > 1) return undefined;
  }
  const fields = extractWorkdayStructuredFields(region, input.sourceUrl);
  const title = fields?.title?.normalize("NFKC").replace(/\s+/gu, " ").trim() ?? "";
  if (title.length < 5 || title.length > 250
    || /^(?:search|search jobs|job search|jobs?|careers?|vacancies|offres? d['’]emploi|recherche d['’]emploi)$/iu.test(title)) return undefined;
  const html = '<section data-workday-selected-vacancy="direct">' + region + '</section>';
  return createAcquisitionContext({
    kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerExternalId: id,
    html, text: randstadText(region), metadata: { providerNamespace: "GENERIC_WORKDAY", sourceName: input.sourceName },
    associationEvidence: ["DIRECT_WORKDAY_ROUTE", "UNIQUE_VISIBLE_HEADER", "MATCHING_BOUNDED_REQUISITION"],
  });
}
