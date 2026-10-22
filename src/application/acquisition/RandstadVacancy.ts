import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { extractRandstadVacancyId } from "./RandstadVacancyUrl.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function randstadText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|address|ul)>/giu, "\n").replace(/<[^>]+>/gu, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/giu, (entity, code: string) => {
      if (code.startsWith("#")) {
        const value = /^#x/iu.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      }
      return ({ amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? entity;
    }).replace(/[ \t]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}
function single(html: string, name: string) {
  const found = elements(html, name);
  return found.length === 1 ? found[0] : undefined;
}
function value(html: string, name: string) { const found = single(html, name); return found ? randstadText(found).replace(/\s+/gu, " ") : undefined; }
function sameReference(left: string, right: string) { return left.toLowerCase() === right.toLowerCase(); }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

export function randstadFacts(html: string) {
  const titles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  const details = single(html, "job-details");
  if (titles.length !== 1 || !details) return undefined;
  const title = randstadText(titles[0]![1]!);
  const reference = value(details, "behat-referenceNumber")?.replace(/^num[eé]ro\s+de\s+r[eé]f[eé]rence\s*/iu, "");
  const location = value(details, "behat-location");
  if (!title || !reference || !location) return undefined;
  return { title, reference, location, salary: value(details, "behat-salary"), contract: value(details, "behat-jobType"),
    education: value(details, "behat-degree"), experience: value(details, "behat-experience"), publishedText: value(details, "behat-dateCreated") };
}

/** Only a unique reference-matched posting can supplement the validated DOM. */
function structuredJob(html: string, id: string) {
  const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(html));
  let conflict = false;
  const matching = postings.filter((posting) => {
    const identifier = typeof posting.identifier === "string" ? posting.identifier : record(posting.identifier)?.value;
    let urlId: string | undefined;
    try { if (typeof posting.url === "string") urlId = extractRandstadVacancyId(new URL(posting.url)); } catch { /* Not an identity. */ }
    const matchesId = typeof identifier === "string" && sameReference(identifier, id);
    const matchesUrl = urlId !== undefined && sameReference(urlId, id);
    if ((matchesId && urlId !== undefined && !matchesUrl) || (matchesUrl && typeof identifier === "string" && !matchesId)
      || (postings.length === 1 && typeof identifier === "string" && !matchesId)) conflict = true;
    return matchesId || matchesUrl;
  });
  if (conflict) return { conflict: true };
  if (matching.length !== 1) return {};
  const posting = matching[0]!;
  // No structured description, salary or title can inject alternate page facts.
  return { job: { identifier: id, employmentType: posting.employmentType, datePosted: posting.datePosted,
    organizationName: record(posting.hiringOrganization)?.name } };
}

export class RandstadSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    let id: string | undefined;
    try { id = extractRandstadVacancyId(new URL(input.sourceUrl)); } catch { return undefined; }
    if (input.providerKey !== "RANDSTAD" || !id || (input.externalId !== undefined && !sameReference(input.externalId, id))) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
    const header = single(clean, "header--job-detail--alternative");
    const details = single(clean, "job-details");
    if (!header || !details || /<(?:nav|footer|form|input|select)\b/iu.test(details)
      || elements(details, "cards__item").length > 0 || elements(details, "job-details").length !== 1) return undefined;
    const facts = randstadFacts(header + details);
    if (!facts || !sameReference(facts.reference, id)) return undefined;
    const favorites = [...header.matchAll(/\bid=["']fav-([^"']+)["']/giu)];
    if (favorites.length !== 1 || !sameReference(favorites[0]![1]!, id)) return undefined;
    for (const tag of (header + details).matchAll(/<[a-z][\w-]*\b[^>]*>/giu)) {
      for (const reference of tag[0].matchAll(/\bdata-(?:job|vacancy|reference)-id=["']([^"']+)["']/giu)) {
        if (!sameReference(reference[1]!, id)) return undefined;
      }
    }
    for (const link of (header + details).matchAll(/\bhref=["']([^"']+)["']/giu)) {
      try {
        const target = new URL(link[1]!.replaceAll("&amp;", "&"), input.sourceUrl);
        const references = [extractRandstadVacancyId(target), ...["url", "u"].map(key => {
          try { const nested = target.searchParams.get(key); return nested ? extractRandstadVacancyId(new URL(nested)) : undefined; } catch { return undefined; }
        })];
        if (references.some(reference => reference !== undefined && !sameReference(reference, id!))) return undefined;
      } catch { /* Unrelated malformed links carry no identity. */ }
    }
    const bodies = elements(details, "body-copy").filter(body => /\bhidden--(?:from|until)-l\b/u.test(body.slice(0, body.indexOf(">"))));
    if (bodies.length < 1 || bodies.length > 2 || new Set(bodies.map(randstadText)).size !== 1
      || bodies.some(body => !/<h3\b[^>]*>\s*descriptif du poste\s*<\/h3>/iu.test(body))) return undefined;
    const summary = single(details, "meta-content");
    if (!summary) return undefined;
    const structured = structuredJob(input.html, id);
    if (structured.conflict) return undefined;
    const title = /<h1\b[^>]*>[\s\S]*?<\/h1>/iu.exec(header)![0];
    const bounded = `${title}<div class="job-details">${summary}${bodies[0]}</div>`;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "RANDSTAD",
      providerExternalId: id, html: bounded, text: randstadText(bounded),
      associationEvidence: ["BOUNDED_JOB_DETAIL", "MATCHING_VACANCY_REFERENCE", "RANDSTAD_DIRECT_JOB", ...(structured.job ? ["MATCHING_JOB_POSTING_REFERENCE"] : [])],
      ...(structured.job ? { metadata: { matchedJobPosting: structured.job } } : {}),
    });
  }
}

export function randstadPublishedAt(context: { metadata?: Readonly<Record<string, unknown>> }): Date | undefined {
  const value = record(context.metadata?.matchedJobPosting)?.datePosted;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
