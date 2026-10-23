import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export const APEC_SOURCE_NAME = "apec.fr";
// An APEC reference is digits followed by a letter (for example 179627528W).
// The "Ref. Société" value is the employer's own number and is never an identity.
const APEC_REFERENCE = /^\d{8,10}[A-Z]$/u;
const DETAIL_ROUTE = /^\/candidat\/recherche-emploi\.html\/emploi\/detail-offre\/(\d{8,10}[A-Za-z])\/?$/u;
const DETAIL_LINK = /\/emploi\/detail-offre\/([^/?#"'\s]+)/giu;
const APPLY_LINK = /#candidature\/promotion\/([^/?#"'\s]+)/giu;

export function isApecSource(sourceName: string, sourceUrl: string) {
  try { return sourceName === APEC_SOURCE_NAME && /^(?:www\.)?apec\.fr$/u.test(new URL(sourceUrl).hostname); } catch { return false; }
}
/** Only the validated candidate detail route establishes a URL reference. */
export function apecVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !/^(?:www\.)?apec\.fr$/u.test(url.hostname)) return undefined;
    return DETAIL_ROUTE.exec(url.pathname)?.[1]?.toUpperCase();
  } catch { return undefined; }
}

function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function line(html: string) { return text(html).replace(/\s+/gu, " ").trim(); }
function cleanHtml(html: string) {
  return html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
}
function elements(html: string, match: (tag: string, open: string) => boolean): string[] {
  const found: string[] = [];
  for (const open of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/giu)) {
    const tag = open[1]!.toLowerCase();
    if (!match(tag, open[0])) continue;
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "giu"); tags.lastIndex = open.index;
    let depth = 0;
    for (let next = tags.exec(html); next; next = tags.exec(html)) {
      depth += next[1] ? -1 : next[0].endsWith("/>") ? 0 : 1;
      if (depth === 0) { found.push(html.slice(open.index, tags.lastIndex)); break; }
    }
  }
  return found;
}
const byTag = (html: string, name: string) => elements(html, tag => tag === name);
function byClass(html: string, name: string) {
  return elements(html, (_tag, open) => {
    const value = /\bclass=(?:"([^"]*)"|'([^']*)')/iu.exec(open);
    return (value?.[1] ?? value?.[2] ?? "").split(/\s+/u).includes(name);
  });
}
function pageDate(value: string | undefined) {
  const match = /(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value ?? "");
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2]}-${match[1]}`, date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? { iso, date } : undefined;
}

// Navigation, map and recommended-job modules are siblings of the selected article.
// Their presence inside a candidate region means the boundary is not trustworthy.
const FOREIGN_MODULE = /<(?:nav|aside|footer|form|input|select|textarea)\b|\bmenu-link-more\b|\blist-offers\b|\bleaflet-|\bmap-zone\b/iu;

export function apecFacts(html: string) {
  const clean = cleanHtml(html);
  if (FOREIGN_MODULE.test(clean)) return undefined;
  const articles = byTag(clean, "article");
  const headings = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  if (articles.length !== 1 || headings.length !== 1 || articles[0]!.includes(headings[0]![0])) return undefined;
  const article = articles[0]!;
  const title = line(headings[0]![1]!);
  const refs = byClass(article, "ref-offre");
  if (!title || title.length > 300 || refs.length !== 1 || byTag(article, "apec-offre-metadata").length !== 1) return undefined;
  const ref = /^Ref\.?\s*Apec\s*:\s*(\d{8,10}[A-Za-z])(?:\s*\/\s*Ref\.?\s*Soci[ée]t[ée]\s*:\s*([^\s/]+))?$/iu.exec(line(refs[0]!));
  if (!ref) return undefined;
  const lists = byClass(article, "details-offer-list");
  const items = lists.length === 1 ? [...lists[0]!.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].map(match => match[1]!) : [];
  const contract = items.length === 3 ? /<span\b[^>]*>([\s\S]*?)<\/span>/iu.exec(items[1]!)?.[1] : undefined;
  const dates = byClass(article, "date-offre").map(line);
  const published = dates.filter(value => /^Publi[ée]e le\b/iu.test(value)), updated = dates.filter(value => /^Actualis[ée]e le\b/iu.test(value));
  if (published.length > 1 || updated.length > 1) return undefined;
  const values: Record<string, string> = {};
  for (const block of byClass(article, "details-post")) {
    const labels = [...block.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/giu)], spans = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/giu)];
    if (labels.length !== 1 || spans.length !== 1) continue;
    const label = line(labels[0]![1]!);
    if (label in values) return undefined;
    values[label] = line(spans[0]![1]!);
  }
  const company = items.length === 3 ? line(items[0]!) : undefined, location = items.length === 3 ? line(items[2]!) : undefined;
  return {
    title, article, apecReference: ref[1]!.toUpperCase(), ...(ref[2] ? { companyReference: ref[2] } : {}),
    ...(company ? { company } : {}), ...(location ? { location } : {}), ...(contract && line(contract) ? { contract: line(contract) } : {}),
    ...(pageDate(published[0]) ? { publishedOn: pageDate(published[0])! } : {}), ...(pageDate(updated[0]) ? { updatedOn: pageDate(updated[0])! } : {}),
    ...(values["Salaire"] ? { salaryText: values["Salaire"] } : {}), details: values, text: text(html),
  };
}

/** "50 - 55 k€ brut annuel" => EUR 50000-55000 per YEAR. No period, no normalization. */
export function parseApecSalary(raw: string) {
  const value = raw.replace(/\s+/gu, " ").trim().replace(/(\d)[ ](?=\d{3}(?!\d))/gu, "$1");
  const number = "(\\d+(?:[.,]\\d+)?)";
  const match = new RegExp(`^${number}(?: ?(?:-|–|—|à) ?${number})? ?(k)? ?€ ?(?:brut(?:e|s)? )?(annuel(?:le)?|mensuel(?:le)?)$`, "iu").exec(value);
  if (!match) return undefined;
  const scale = match[3] ? 1000 : 1;
  const minimum = Number(match[1]!.replace(",", ".")) * scale, maximum = Number((match[2] ?? match[1]!).replace(",", ".")) * scale;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) return undefined;
  return { rawText: raw.replace(/\s+/gu, " ").trim(), currency: "EUR", minimum: Math.round(minimum), maximum: Math.round(maximum),
    period: /^annuel/iu.test(match[4]!) ? "YEAR" as const : "MONTH" as const };
}

function postings(html: string) {
  return new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(html));
}
export { byTag as htmlByTag, byClass as htmlByClass, cleanHtml, line as htmlLine, postings as jobPostings };
function structuredReference(posting: Record<string, unknown>) {
  const identifier = record(posting.identifier)?.value ?? posting.identifier;
  return typeof identifier === "string" || typeof identifier === "number" ? String(identifier).trim().toUpperCase() : undefined;
}

export type ApecIdentity =
  | { readonly status: "VALID"; readonly id: string; readonly companyReference?: string }
  | { readonly status: "CONFLICT"; readonly identifiers: readonly string[] }
  | { readonly status: "UNVERIFIED" };

/** Compare every APEC identity source on the selected page. The company reference never counts as APEC identity. */
export function apecIdentity(input: { readonly sourceUrl: string; readonly html: string; readonly externalId?: string }): ApecIdentity {
  const urlId = apecVacancyId(input.sourceUrl);
  if (!urlId) return { status: "UNVERIFIED" };
  const clean = cleanHtml(input.html);
  const details = byTag(clean, "apec-detail-emploi");
  const articles = details.length === 1 ? byTag(details[0]!, "article") : [];
  const region = articles.length === 1 ? articles[0]! : "";
  const found = [urlId];
  if (input.externalId !== undefined) found.push(input.externalId.trim().toUpperCase());
  let selectedReference: string | undefined, companyReference: string | undefined;
  for (const ref of byClass(region, "ref-offre")) {
    const parsed = /^Ref\.?\s*Apec\s*:\s*(\S+?)(?:\s*\/\s*Ref\.?\s*Soci[ée]t[ée]\s*:\s*([^\s/]+))?$/iu.exec(line(ref));
    if (!parsed) continue;
    found.push(parsed[1]!.toUpperCase());
    selectedReference ??= parsed[1]!.toUpperCase();
    companyReference ??= parsed[2];
  }
  for (const pattern of [APPLY_LINK, DETAIL_LINK]) for (const match of region.matchAll(pattern)) found.push(match[1]!.toUpperCase());
  for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
    if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/iu.test(tag[0])) continue;
    const url = /\b(?:href|content)=["']([^"']+)["']/iu.exec(tag[0])?.[1];
    for (const match of (url ?? "").matchAll(DETAIL_LINK)) found.push(match[1]!.toUpperCase());
  }
  const structured = postings(input.html);
  if (structured.length === 1) { const reference = structuredReference(structured[0]!); if (reference) found.push(reference); }
  const distinct = [...new Set(found)];
  if (distinct.length > 1 || (companyReference !== undefined && distinct.includes(companyReference.toUpperCase()))) return { status: "CONFLICT", identifiers: distinct };
  return selectedReference === urlId && APEC_REFERENCE.test(urlId) ? { status: "VALID", id: urlId, ...(companyReference ? { companyReference } : {}) } : { status: "UNVERIFIED" };
}

export function apecPublishedAt(context: { readonly html?: string; readonly metadata?: Readonly<Record<string, unknown>> } | undefined) {
  const published = context?.html ? apecFacts(context.html)?.publishedOn : undefined;
  if (!published) return undefined;
  const raw = record(context?.metadata?.matchedJobPosting)?.datePosted;
  const precise = typeof raw === "string" ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/u.exec(raw.trim()) : null;
  const exact = precise ? new Date(`${precise[1]}T${precise[2]}${precise[3]}:${precise[4]}`) : undefined;
  return exact && Number.isFinite(exact.getTime()) && precise![1] === published.iso ? exact : published.date;
}

export class ApecSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = apecVacancyId(input.sourceUrl);
    if (input.providerKey !== "APEC" || !id || (input.externalId !== undefined && input.externalId.toUpperCase() !== id)) return undefined;
    const identity = apecIdentity({ sourceUrl: input.sourceUrl, html: input.html, externalId: id });
    if (identity.status !== "VALID") return undefined;
    const clean = cleanHtml(input.html);
    const modules = byTag(clean, "apec-detail-emploi");
    if (modules.length !== 1) return undefined;
    const articles = byTag(modules[0]!, "article");
    const headings = [...modules[0]!.matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/giu)];
    if (articles.length !== 1 || headings.length !== 1 || articles[0]!.includes(headings[0]![0])) return undefined;
    const opening = articles[0]!.slice(0, articles[0]!.indexOf(">") + 1);
    if (/\baria-hidden=["']true["']|\s+hidden(?:[\s=>])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(opening)) return undefined;
    // The share widget is page chrome inside the article card.
    const selected = articles[0]!.replace(byTag(articles[0]!, "apec-social-share")[0] ?? "", "");
    const bounded = `<div class="apec-selected-vacancy">${headings[0]![0]}${selected}</div>`;
    const facts = apecFacts(bounded);
    if (!facts || facts.apecReference !== id) return undefined;
    const candidates = postings(input.html);
    const posting = candidates.length === 1 && line(String(candidates[0]!.title ?? "")) === facts.title
      && (!facts.company || record(candidates[0]!.hiringOrganization)?.name === facts.company) ? candidates[0] : undefined;
    const matchedJobPosting = posting ? {
      ...(typeof posting.datePosted === "string" ? { datePosted: posting.datePosted } : {}),
      ...(typeof posting.employmentType === "string" ? { employmentType: posting.employmentType } : {}),
      ...(record(posting.baseSalary) ? { baseSalary: posting.baseSalary } : {}),
    } : undefined;
    return createAcquisitionContext({
      kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "APEC", providerExternalId: id,
      html: bounded, text: facts.text,
      metadata: { apecReference: id, ...(facts.companyReference ? { companyReference: facts.companyReference } : {}), ...(matchedJobPosting ? { matchedJobPosting } : {}) },
      associationEvidence: ["BOUNDED_JOB_DETAIL", "APEC_DETAIL_URL_REFERENCE", "SELECTED_PAGE_REFERENCE", "VACANCY_BODY_TITLE", ...(posting ? ["MATCHED_JOB_POSTING"] : [])],
    });
  }
}
