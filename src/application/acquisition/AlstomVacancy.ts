import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
export const ALSTOM_HOST = "jobsearch.alstom.com";
export function alstomPostingId(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname === ALSTOM_HOST ? /^\/job\/[^/]+\/([1-9]\d*)\/?$/u.exec(url.pathname)?.[1] : undefined;
  } catch {
    return undefined;
  }
}
function attr(open: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "iu").exec(open)?.[1];
}
/** Balanced same-tag traversal retains nested spans, divs and complete tables. */
export function alstomElements(html: string, accepts: (open: string, tag: string) => boolean): string[] {
  const found: string[] = [];
  for (const start of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/giu)) {
    if (!accepts(start[0], start[1]!.toLowerCase())) continue;
    const tags = new RegExp(`<(/?)${start[1]}\\b[^>]*>`, "giu");
    tags.lastIndex = start.index;
    let depth = 0;
    for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
      depth += tag[1] ? -1 : 1;
      if (depth === 0) {
        found.push(html.slice(start.index, tags.lastIndex));
        break;
      }
    }
  }
  return found;
}
function clean(html: string) {
  return html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
}
function hidden(html: string) {
  return /\s+hidden(?:\s|=|>)|\baria-hidden=["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(html);
}
const byId = (html: string, id: string) => alstomElements(html, open => attr(open, "id") === id);
const flat = (html: string) => randstadText(html).replace(/\s+/gu, " ").trim();
function publishedDate(html: string) {
  // The labelled publication day is locale-aware; never use Date.parse's locale
  // heuristics, the capture timestamp, or the microdata's time of day.
  const match = /^Date:\s*(\d{1,2})\s+([\p{L}]+)\.?\s+(\d{4})$/iu.exec(flat(html));
  const months: Readonly<Record<string, number>> = {
    jan:1, janv:1, janvier:1, feb:2, fevr:2, fevrier:2,
    mar:3, mars:3, apr:4, avr:4, avril:4, may:5, mai:5,
    jun:6, juin:6, jul:7, juil:7, juillet:7, aug:8, aout:8,
    sep:9, sept:9, septembre:9, oct:10, octobre:10,
    nov:11, novembre:11, dec:12, decembre:12,
  };
  const token = match?.[2]?.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const month = token === undefined ? undefined : months[token];
  if (!match || month === undefined) return undefined;
  const iso = `${match[3]}-${String(month).padStart(2,"0")}-${match[1]!.padStart(2,"0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso ? date : undefined;
}

export function alstomFacts(html: string) {
  const titles = byId(html, "job-title"),
    locations = byId(html, "job-location"),
    companies = byId(html, "job-company"),
    dates = byId(html, "job-date");
  const descriptions = alstomElements(html, open => attr(open, "class")?.split(/\s+/u).includes("jobdescription") === true && attr(open, "itemprop") === "description");
  if (titles.length !== 1 || locations.length !== 1 || companies.length !== 1 || descriptions.length !== 1 || dates.length > 1) return undefined;
  const parts = [titles[0]!, ...(dates[0] ? [dates[0]] : []), locations[0]!, companies[0]!, descriptions[0]!];
  if (parts.some(hidden)) return undefined;
  if (parts.some(part => /<(?:nav|aside|footer|form|input|select|button)\b/iu.test(part))) return undefined;
  const title = flat(titles[0]!),
    location = /^(?:Location|Lieu)\s*:\s*(.+)$/iu.exec(flat(locations[0]!))?.[1],
    company = /^(?:Company|Entreprise)\s*:\s*(.+)$/iu.exec(flat(companies[0]!))?.[1];
  const description = randstadText(descriptions[0]!);
  const requisitions = [...description.matchAll(/\bReq\s+ID:\s*(\d+)\b/giu)];
  if (!title || title.length > 250 || !location || !company || requisitions.length !== 1) return undefined;
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const englishEmployer = new RegExp(`\\bAt ${escaped},?\\s+we\\b`, "iu").test(description)
    && /\b(?:we['’]re|we are|an?)\s+(?:an?\s+)?equal[- ]opportunity employer\b/iu.test(description);
  const frenchEmployer = new RegExp(`\\b${escaped}\\s+garantit\\s+l['’]égalité des chances[^.!?\\n]{0,160}\\ben tant qu['’]employeur\\b`, "iu").test(description);
  const clientHiring = /\b(?:recruiting|hiring)\s+for\s+our\s+client\b|\b(?:recrutons|recrute)\s+pour\s+(?:notre|le)\s+client\b/iu.test(description);
  const directEmployer = (englishEmployer || frenchEmployer) && !clientHiring;
  return {
    title,
    location,
    company,
    description,
    requisitionId: requisitions[0]![1]!,
    directEmployer,
    publishedAt: dates[0] ? publishedDate(dates[0]) : undefined,
    html: `<section data-alstom-selected-vacancy-context="detail">${parts.join("\n")}</section>`
  };
}
export class AlstomSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const postingId = alstomPostingId(input.sourceUrl);
    if (input.providerKey !== "ALSTOM" || !postingId || input.externalId !== undefined && input.externalId !== postingId) return undefined;
    const html = clean(input.html);
    const shells = alstomElements(html, open => attr(open, "class")?.split(/\s+/u).includes("jobDisplayShell") === true && /^https?:\/\/schema\.org\/JobPosting$/u.test(attr(open, "itemtype") ?? ""));
    if (shells.length !== 1 || hidden(shells[0]!.slice(0, shells[0]!.indexOf(">") + 1))) return undefined;
    const facts = alstomFacts(shells[0]!);
    if (!facts) return undefined;
    const canonicalLinks = [...html.matchAll(/<link\b[^>]*>/giu)].filter(m => attr(m[0], "rel") === "canonical");
    if (canonicalLinks.length > 1 || canonicalLinks.some(m => alstomPostingId(attr(m[0], "href") ?? "") !== postingId)) return undefined;
    const applyIds = [...shells[0]!.matchAll(/\bhref=["']([^"']+)["']/giu)].flatMap(m => {
      try {
        const url = new URL(m[1]!, input.sourceUrl);
        const ref = /^\/talentcommunity\/apply\/(\d+)\/?$/u.exec(url.pathname)?.[1];
        return ref ? [url.hostname === ALSTOM_HOST ? ref : "INVALID_HOST"] : [];
      } catch {
        return [];
      }
    });
    if (!applyIds.length || applyIds.some(id => id !== postingId)) return undefined;
    return createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "ALSTOM",
      providerExternalId: postingId,
      html: facts.html,
      text: randstadText(facts.html),
      metadata: {
        postingId,
        requisitionId: facts.requisitionId,
        ...(facts.publishedAt ? {
          publishedAt: facts.publishedAt.toISOString()
        } : {})
      },
      associationEvidence: ["VALIDATED_DETAIL_ROUTE", "MATCHING_APPLY_POSTING_ID", "BOUNDED_JOB_HEADER_AND_DESCRIPTION", "DISTINCT_REQUISITION_ID"]
    });
  }
}
