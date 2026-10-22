import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export function adeccoVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    if (!/^(?:www\.)?adecco\.com$/u.test(url.hostname) || !["http:", "https:"].includes(url.protocol)) return undefined;
    return /^\/fr-fr\/offres-emploi\/[^/]+\/(\d+)\/?$/u.exec(url.pathname)?.[1];
  } catch { return undefined; }
}

export class AdeccoSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "ADECCO") return undefined;
    try {
      const url = new URL(input.sourceUrl);
      if (!/^(?:www\.)?adecco\.com$/u.test(url.hostname) || url.pathname !== "/fr-fr/offres-emploi") return undefined;
    } catch { return undefined; }
    const html = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
    const panels = adeccoElementsWithClass(html, "job_Details");
    if (panels.length !== 1) return undefined;
    const pane = panels[0]!;
    if (!/^<section\b/iu.test(pane) || adeccoElementsWithClass(pane, "scrollbar-wrapper").length !== 1
      || adeccoElementsWithClass(pane, "VacancyDescription").length !== 1
      || adeccoElementsWithClass(pane, "job-card").length > 0 || /<(?:input|select|aside|footer)\b/iu.test(pane)
      || adeccoSelectedFacts(pane) === undefined) return undefined;
    const links = adeccoElementsWithClass(pane, "static_jobdetailpage_url");
    if (links.length !== 1) return undefined;
    const href = attribute(links[0]!, "href");
    let externalId: string | undefined;
    try { externalId = href === undefined ? undefined : adeccoVacancyId(new URL(href.replaceAll("&amp;", "&"), input.sourceUrl).href); } catch { return undefined; }
    if (externalId === undefined || (input.externalId !== undefined && input.externalId !== externalId)) return undefined;
    const references = adeccoElementsWithClass(pane, "job-id").map(adeccoHtmlToText);
    if (references.length !== 1 || references[0] !== externalId) return undefined;
    for (const tag of pane.match(/<[a-z][\w-]*\b[^>]*>/giu) ?? []) {
      for (const key of ["data-job-id", "data-vacancy-id"]) {
        const id = attribute(tag, key);
        if (id !== undefined && id !== externalId) return undefined;
      }
      const link = attribute(tag, "href");
      if (link === undefined) continue;
      try {
        const target = new URL(link.replaceAll("&amp;", "&"), input.sourceUrl);
        const id = adeccoVacancyId(target.href);
        if (id !== undefined && id !== externalId) return undefined;
        for (const key of ["url", "u", "text"]) {
          const nested = target.searchParams.get(key);
          const sharedId = nested === null ? undefined : adeccoVacancyId(nested);
          if (sharedId !== undefined && sharedId !== externalId) return undefined;
        }
      } catch { /* Ignore unrelated malformed links. */ }
    }
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "ADECCO",
      providerExternalId: externalId, html: pane, text: adeccoHtmlToText(pane),
      associationEvidence: ["BOUNDED_JOB_DETAIL", "ADECCO_JOB_DETAILS", "MATCHING_DIRECT_VACANCY_LINK", "MATCHING_VACANCY_REFERENCE"] });
  }
}

export function adeccoSelectedFacts(html: string) {
  const headers = adeccoElementsWithClass(html, "scrollbar-box");
  if (headers.length !== 1) return undefined;
  const titles = adeccoElementsWithClass(headers[0]!, "h3");
  if (titles.length !== 1) return undefined;
  const values = new Map<string, string>();
  for (const row of adeccoElementsWithClass(headers[0]!, "job-icon")) {
    const spans = [...row.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span\s*>/giu)].map((m) => adeccoHtmlToText(m[1]!));
    if (spans.length !== 2 || values.has(spans[0]!)) return undefined;
    values.set(spans[0]!, spans[1]!);
  }
  const title = adeccoHtmlToText(titles[0]!);
  const salary = adeccoElementsWithClass(headers[0]!, "text-salary");
  if (!title || salary.length > 1) return undefined;
  const countText = values.get("format_list_numbered");
  const count = /^Poste\(s\)\s+[àa]\s+pourvoir\s*:\s*([1-9]\d*)$/iu.exec(countText ?? "")?.[1];
  const contract = values.get("work_outline");
  const schedule = values.get("acute");
  return { title, location: values.get("location_on"), salary: salary[0] === undefined ? undefined : adeccoHtmlToText(salary[0]),
    contract, schedule, positionCount: count === undefined || !Number.isSafeInteger(Number(count)) ? undefined : Number(count),
    positionCountText: countText, startDateText: values.get("event") };
}

export function adeccoElementsWithClass(html: string, className: string): string[] {
  return [...html.matchAll(/<([a-z][\w-]*)\b[^>]*>/giu)].flatMap((match) => {
    if (!attribute(match[0], "class")?.split(/\s+/u).includes(className)) return [];
    const element = balancedElement(html, match[1]!, match.index);
    return element === undefined ? [] : [element];
  });
}

function balancedElement(html: string, name: string, start: number): string | undefined {
  const tags = new RegExp(`<\\/?${name}\\b[^>]*>`, "giu");
  tags.lastIndex = start;
  let depth = 0;
  for (let tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2];
}

function adeccoHtmlToText(html: string): string {
  return html.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|section|span|b)\s*>/giu, "\n").replace(/<[^>]+>/gu, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/giu, (entity, code: string) => {
      if (code.startsWith("#")) {
        const value = /^#x/iu.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      }
      return ({ amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? entity;
    }).replace(/[ \t]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}
