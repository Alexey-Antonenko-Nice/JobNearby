import { createAcquisitionContext, type AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { alstomElements } from "./AlstomVacancy.js";

/** The existing direct-page boundary: one visible div.job-header and one title. */
export class PersonioSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]): AcquisitionContext | undefined {
    const id = extractPersonioVacancyId(input.sourceUrl);
    if (input.providerKey !== "PERSONIO" || id === undefined
      || !/^https?:/iu.test(input.sourceUrl)
      || input.externalId !== undefined && input.externalId !== id) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const hasClass = (open: string, name: string) => /\bclass=["']([^"']*)["']/iu.exec(open)?.[1]?.split(/\s+/u).includes(name) === true;
    const headers = alstomElements(clean, open => hasClass(open, "job-header"));
    if (headers.length !== 1 || !/^<div\b/iu.test(headers[0]!)) return undefined;
    const header = headers[0]!;
    const titles = alstomElements(header, (open, tag) => tag === "h1" && hasClass(open, "job-position-title"));
    const hidden = (html: string) => /\s+hidden(?:\s|=|>)|\baria-hidden=["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(html);
    if (titles.length !== 1 || hidden(header)) return undefined;
    if (alstomElements(clean, open => hidden(open)).some(region => region.includes(header))) return undefined;
    const title = extractPersonioHeaderFacts(header).title ?? "";
    const normalized = title.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (normalized.length < 5 || normalized.length > 250
      || /^(?:search|search jobs|job search|jobs?|careers?|vacancies|offres? d['’]emploi|recherche d['’]emploi)$/iu.test(normalized)) return undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR",
      providerKey: "PERSONIO", providerExternalId: id, html: header, text: text(header),
      associationEvidence: ["PERSONIO_DIRECT_JOB_ROUTE", "UNIQUE_VISIBLE_JOB_HEADER", "UNIQUE_MEANINGFUL_TITLE"] });
  }
}

export function isPersonioHostname(hostname: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.jobs\.personio\.de$/iu.test(hostname);
}

export function isPersonioSource(sourceName: string, sourceUrl: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return hostname === sourceName && isPersonioHostname(hostname);
  } catch { return false; }
}

export function extractPersonioVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    return isPersonioHostname(url.hostname) ? /^\/job\/(\d+)\/?$/u.exec(url.pathname)?.[1] : undefined;
  } catch { return undefined; }
}

export interface PersonioHeaderFacts {
  readonly title?: string;
  readonly contractTerms: readonly string[];
  readonly salaryText?: string;
}

/** Only explicit attributes inside the Personio vacancy header; never body offers. */
export function extractPersonioHeaderFacts(html: string): PersonioHeaderFacts {
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
  const headers = [...clean.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bjob-header\b[^"']*["'][^>]*>/giu)];
  if (headers.length !== 1) return { contractTerms: [] };
  const start = headers[0]!.index;
  const tags = /<\/?div\b[^>]*>/giu;
  tags.lastIndex = start;
  let depth = 0;
  let header: string | undefined;
  for (let match = tags.exec(clean); match !== null; match = tags.exec(clean)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) { header = clean.slice(start, tags.lastIndex); break; }
  }
  if (header === undefined) return { contractTerms: [] };
  const titleMatch = /<h1\b[^>]*\bclass=["'][^"']*\bjob-position-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu.exec(header);
  const title = titleMatch === null ? undefined : text(titleMatch[1]!);
  const attributes = [...header.matchAll(/<span\b[^>]*\bclass=["'][^"']*\bJobAttributes_jobMetaText__[\w-]+[^"']*["'][^>]*>([^<]*)<\/span>/giu)]
    .map((match) => text(match[1]!));
  const contractTerms = [...new Set(attributes.filter((value) => /^(?:full[-\s]time|part[-\s]time|permanent employee)$/iu.test(value)))];
  const salaries = attributes.filter((value) => /(?:€|\bEUR\b)/u.test(value) && /\bper year$/iu.test(value));
  return {
    ...(title ? { title } : {}), contractTerms,
    ...(salaries.length === 1 ? { salaryText: salaries[0]! } : {}),
  };
}

function text(value: string): string {
  return value.replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;|&#x[aA]0;/gu, " ").replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"').replace(/&#39;|&apos;/gu, "'")
    .replace(/\s+/gu, " ").trim();
}
