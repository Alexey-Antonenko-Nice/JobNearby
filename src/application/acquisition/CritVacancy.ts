import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function critVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?crit-job\.com$/u.test(url.hostname) || !["https:", "http:"].includes(url.protocol)) return undefined;
    const id = /^\/offres\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
    return id && uuid.test(id) ? id : undefined;
  } catch { return undefined; }
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
export function critSection(html: string, title: string): string | undefined {
  const found = elements(html, "MuiStack-root").filter(block => {
    const heading = /^<div\b[^>]*>\s*<h2\b[^>]*>([\s\S]*?)<\/h2>/iu.exec(block)?.[1];
    return heading !== undefined && randstadText(heading) === title;
  });
  return found.length === 1 ? found[0] : undefined;
}
export function critFacts(html: string) {
  const titles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  const summary = critSection(html, "Summary");
  const description = critSection(html, "Job description");
  if (titles.length !== 1 || !summary || !description || !critSection(html, "Desired profile") || !critSection(html, "Other information")) return undefined;
  const paragraphs = [...summary.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map(m => randstadText(m[1]!));
  const labels = ["Location", "Start date", "Contract", "Contract duration", "Salary"];
  const values: Record<string, string> = {};
  for (const label of labels) {
    const indices = paragraphs.flatMap((value, i) => value === label ? [i] : []);
    if (indices.length !== 1) return undefined;
    const start = indices[0]! + 1;
    let end = start;
    while (end < paragraphs.length && !labels.includes(paragraphs[end]!)) end++;
    if (start === end) return undefined;
    values[label] = paragraphs.slice(start, end).join(" ");
  }
  const title = randstadText(titles[0]![1]!);
  return title ? { title, values, description: randstadText(description) } : undefined;
}
export class CritSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = critVacancyId(input.sourceUrl);
    if (input.providerKey !== "CRIT" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const mains = [...clean.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/giu)];
    if (mains.length !== 1) return undefined;
    const main = mains[0]![0];
    const facts = critFacts(main);
    if (!facts) return undefined;
    const published = [...main.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/giu)].map(m => m[0]).filter(p => /^(?:Offer posted on|Offre publi[eé]e le)\s/iu.test(randstadText(p)));
    if (published.length !== 1) return undefined;
    const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/iu.exec(main)![0];
    const bounded = h1 + published[0]! + ["Job description", "Desired profile", "Summary", "Other information"].map(title => critSection(main, title)!).join("\n");
    if (/<(?:nav|footer|input|select|form|main)\b/iu.test(bounded)) return undefined;
    for (const match of bounded.matchAll(/\bdata-(?:offer|job|vacancy)-id=["']([^"']+)["']/giu)) if (match[1] !== id) return undefined;
    for (const link of bounded.matchAll(/\bhref=["']([^"']+)["']/giu)) {
      try { const linked = critVacancyId(new URL(link[1]!, input.sourceUrl).href); if (linked && linked !== id) return undefined; } catch { /* Not a vacancy link. */ }
    }
    for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
      if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/iu.test(tag[0])) continue;
      const value = /\b(?:href|content)=["']([^"']+)["']/iu.exec(tag[0])?.[1];
      const explicit = value ? critVacancyId(value) : undefined;
      if (explicit && explicit !== id) return undefined;
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    let conflict = false;
    const matching = postings.filter(posting => {
      const identifiers = (Array.isArray(posting.identifier) ? posting.identifier : [posting.identifier]).flatMap(item => {
        const value = typeof item === "string" ? item : record(item)?.value;
        return typeof value === "string" && uuid.test(value) ? [value] : [];
      });
      const urlId = typeof posting.url === "string" ? critVacancyId(posting.url) : undefined;
      const matches = urlId === id || identifiers.includes(id);
      if ((matches || postings.length === 1) && (identifiers.some(value => value !== id) || (urlId !== undefined && urlId !== id))) conflict = true;
      return matches;
    });
    if (conflict) return undefined;
    const posting = matching.length === 1 ? matching[0] : undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "CRIT", providerExternalId: id,
      html: bounded, text: randstadText(bounded), associationEvidence: ["BOUNDED_JOB_DETAIL", "CRIT_DIRECT_JOB", "URL_EXTERNAL_ID", ...(posting ? ["MATCHING_JOB_POSTING_REFERENCE"] : [])],
      ...(posting ? { metadata: { organizationName: record(posting.hiringOrganization)?.name, datePosted: posting.datePosted } } : {}),
    });
  }
}
export function critPublishedAt(metadata?: Readonly<Record<string, unknown>>) {
  const value = metadata?.datePosted;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
