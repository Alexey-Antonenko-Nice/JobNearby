import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export function helloWorkVacancyId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/^(?:www\.)?hellowork\.com$/iu.test(parsed.hostname)) return undefined;
    return /^\/[a-z]{2}-[a-z]{2}\/emplois\/(\d+)(?:\.html)?\/?$/iu.exec(parsed.pathname)?.[1];
  } catch { return undefined; }
}

/** Page-level JSON-LD is usable only with an unambiguous current-job URL. */
export function helloWorkJobPostings(html: string, url: string) {
  const id = helloWorkVacancyId(url);
  if (id === undefined) return [];
  const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(html));
  const matching = postings.filter((posting) => typeof posting.url === "string" && helloWorkVacancyId(posting.url) === id);
  return matching.length === 1 ? matching : [];
}

export function helloWorkHeaderFields(html: string) {
  const header = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/iu.exec(html)?.[1] ?? "";
  const title = /<span\b[^>]*\bdata-cy=["']jobTitle["'][^>]*>([\s\S]*?)<\/span\s*>/iu.exec(header)?.[1];
  const company = /<a\b[^>]*\bhref=["']\/[a-z]{2}-[a-z]{2}\/entreprises\/[^"']+["'][^>]*>([\s\S]*?)<\/a\s*>/iu.exec(header)?.[1];
  const chips = /<\/h1\s*>\s*<ul\b[^>]*>([\s\S]*?)<\/ul\s*>/iu.exec(html)?.[1] ?? "";
  const location = helloWorkHtmlToText(chips).split("\n").find((line) => /^[\p{L}][\p{L} '\u2019.-]+ - (?:\d{2,3}|2[AB])$/u.test(line));
  return {
    ...(title === undefined ? {} : { title: helloWorkHtmlToText(title) }),
    ...(company === undefined ? {} : { displayedCompanyName: helloWorkHtmlToText(company) }),
    ...(location === undefined ? {} : { locationText: location.replace(/ - (?:\d{2,3}|2[AB])$/u, "") }),
  };
}

export class HelloWorkSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = helloWorkVacancyId(input.sourceUrl);
    if (input.providerKey !== "HELLOWORK" || id === undefined || input.externalId !== id) return undefined;
    const html = input.html.replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
    const panels = [...html.matchAll(/<div\b[^>]*\bid\s*=\s*["']offer-panel["'][^>]*>/giu)];
    if (panels.length !== 1) return undefined;
    const start = panels[0]!.index;
    const tags = /<\/?div\b[^>]*>/giu;
    tags.lastIndex = start;
    let depth = 0;
    let bounded: string | undefined;
    for (let tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
      depth += tag[0].startsWith("</") ? -1 : 1;
      if (depth === 0) { bounded = html.slice(start, tags.lastIndex); break; }
    }
    if (bounded === undefined || !/\brole\s*=\s*["']tabpanel["']/iu.test(panels[0]![0])
      || [...bounded.matchAll(/<h1\b/giu)].length !== 1
      || !/<h1\b[^>]*\bid\s*=\s*["']main-content["']/iu.test(bounded)
      || !/\bdata-cy\s*=\s*["']jobTitle["']/iu.test(bounded)) return undefined;
    // A competing vacancy link or nested card invalidates the boundary.
    if (/\bid\s*=\s*["'](?:similar-offers|company-panel)["']|<(?:aside|nav|footer)\b/iu.test(bounded)) return undefined;
    for (const link of bounded.matchAll(/\bhref\s*=\s*["']([^"']+)["']/giu)) {
      let linked: string | undefined;
      try { linked = helloWorkVacancyId(new URL(link[1]!, input.sourceUrl).href); } catch { continue; }
      if (linked !== undefined && linked !== id) return undefined;
    }
    const text = helloWorkHtmlToText(bounded);
    if (!text) return undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR",
      providerKey: "HELLOWORK", providerExternalId: id, text, html: bounded,
      associationEvidence: ["URL_EXTERNAL_ID", "HELLOWORK_OFFER_PANEL", "BOUNDED_JOB_DETAIL"] });
  }
}

function helloWorkHtmlToText(html: string): string {
  return html.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|section|span|a|summary)\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/giu, (entity, code: string) => {
      if (code.startsWith("#")) {
        const number = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return number <= 0x10ffff ? String.fromCodePoint(number) : entity;
      }
      return ({ amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? entity;
    }).replace(/[ \t]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}
