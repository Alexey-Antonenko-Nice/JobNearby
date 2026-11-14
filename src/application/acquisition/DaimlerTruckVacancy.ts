import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor, type RawSchemaOrgJobPosting } from "./SchemaOrgJobPostingExtractor.js";

export const DAIMLER_TRUCK_SOURCE = "jobsearch.daimlertruck.com";

export function daimlerTruckRouteId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== DAIMLER_TRUCK_SOURCE
      || url.pathname !== "/index.php" || url.searchParams.getAll("ac").length !== 1
      || url.searchParams.get("ac") !== "jobad" || url.searchParams.getAll("id").length !== 1) return undefined;
    const id = url.searchParams.get("id")!;
    return /^\d+$/u.test(id) ? id : undefined;
  } catch { return undefined; }
}

/** Shared acceptance/evidence boundary. Never select the first of competing postings. */
export function trustedDaimlerVacancy(input: {
  sourceName: string; sourceUrl?: string; externalId?: string; html?: string;
}): TrustedDaimlerVacancy | undefined {
  if (input.sourceName !== DAIMLER_TRUCK_SOURCE || input.html === undefined) return undefined;
  const id = daimlerTruckRouteId(input.sourceUrl ?? "");
  if (id === undefined || input.externalId !== id) return undefined;
  const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
  if (postings.length !== 1) return undefined;
  const posting = postings[0]!;
  const title = typeof posting.title === "string" ? posting.title.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
  if (title.length < 5 || title.length > 250
    || /^(?:search|search jobs|job search|jobs?|careers?|vacancies|offres? d['’]emploi|recherche d['’]emploi)$/iu.test(title)) return undefined;
  if (posting.url !== undefined
    && (typeof posting.url !== "string" || daimlerTruckRouteId(posting.url) !== id)) return undefined;
  const proof = validateDom(input.html, id, posting);
  if (proof === undefined) return undefined;
  return { routeId: id, posting, ...proof };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export interface TrustedDaimlerVacancy {
  readonly routeId: string;
  readonly posting: RawSchemaOrgJobPosting;
  readonly secondaryJobNumber?: string;
  readonly hasContainer: boolean;
}

export function trustedDaimlerJobPosting(input: {
  sourceName: string; sourceUrl?: string; externalId?: string; html?: string;
}): RawSchemaOrgJobPosting | undefined {
  return trustedDaimlerVacancy(input)?.posting;
}

const ORACLE_APPLY = "https://fa-exdu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/fr-CA/sites/CX_1/job/";
const hidden = (open: string) => /\s+hidden(?:\s|=|>)|\baria-hidden\s*=\s*["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(open)
  || (attr(open.slice(0, open.indexOf(">") + 1), "class") ?? "").split(/\s+/u).includes("hidden");
function daimlerElements(html: string, accepts: (open: string, tag: string) => boolean): string[] {
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
function daimlerText(html: string): string {
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
const flat = (html: string) => daimlerText(html).replace(/\s+/gu, " ").trim();
function attr(open: string, name: string): string | undefined {
  const matches = [...open.matchAll(new RegExp('\\s' + name + '(?=\\s|=|>)(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+)))?', 'giu'))];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) return "INVALID_DUPLICATE";
  const value = matches[0]![1] ?? matches[0]![2] ?? matches[0]![3];
  return value === undefined ? "INVALID_ATTRIBUTE" : value.replace(/&amp;/gu, "&");
}
function number(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value) ? value : undefined;
}
function validateDom(html: string, routeId: string, posting: RawSchemaOrgJobPosting):
  Pick<TrustedDaimlerVacancy, "secondaryJobNumber" | "hasContainer"> | undefined {
  const clean = html.replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
  const opens = [...clean.matchAll(/<[a-z][\w-]*\b[^>]*>/giu)].map(match => match[0]);
  const containers = daimlerElements(clean, open => attr(open, "id") === "jobad-container");
  const containerOpens = opens.filter(open => attr(open, "id") === "jobad-container" || attr(open, "data-jobad-id") !== undefined);
  const hiddenIds = opens.filter(open => /^<input\b/iu.test(open) && attr(open, "name") === "jobad_id");
  if (hiddenIds.length > 1 || hiddenIds.some(open => attr(open, "value") !== routeId)) return undefined;
  if (containerOpens.length > 1 || containers.length !== containerOpens.length) return undefined;
  const region = containers[0];
  if (region !== undefined) {
    const open = containerOpens[0]!;
    if (attr(open, "data-jobad-id") !== routeId || hidden(open)
      || daimlerElements(clean, hidden).some(parent => parent.includes(region))) return undefined;
    const uri = attr(open, "data-uri");
    // The observed DOM metadata uses //index.php. This exception is NOT a source-route expansion.
    if (uri !== undefined && daimlerTruckRouteId(uri.replace(".com//index.php", ".com/index.php")) !== routeId) return undefined;
  } else if (hiddenIds.length > 0) return undefined;
  const labels = daimlerElements(clean, (_open, tag) => tag === "h4").filter(h => /^Job number\s*:/iu.test(flat(h)));
  // Unsupported/extra labelled references are a veto, never a fallback source.
  if ([...flat(clean).matchAll(/Job number\s*:/giu)].length !== labels.length) return undefined;
  const links = daimlerElements(clean, (_open, tag) => tag === "a").filter(a => {
    const href = attr(a.slice(0, a.indexOf(">") + 1), "href") ?? "";
    return /CandidateExperience|\/job\/[^/]+\/apply/iu.test(href);
  });
  const applyOpens = opens.filter(open => /^<a\b/iu.test(open) && /CandidateExperience|\/job\/[^/]+\/apply/iu.test(attr(open, "href") ?? ""));
  if (applyOpens.length !== links.length) return undefined;
  if (posting.identifier === undefined && labels.length === 0 && links.length === 0) return { hasContainer: region !== undefined };
  // Secondary identities require all three independent signals within one public-ad region.
  const identifier = record(posting.identifier);
  const secondary = number(identifier?.value);
  if (identifier?.["@type"] !== "PropertyValue" || secondary === undefined
    || region === undefined || labels.length !== 1 || links.length === 0) return undefined;
  const label = labels[0]!;
  if (!region.includes(label) || hidden(label) || daimlerElements(clean, hidden).some(parent => parent.includes(label))) return undefined;
  const after = region.slice(region.indexOf(label) + label.length);
  const value = /^\s*(<span\b[^>]*>[\s\S]*?<\/span>)/iu.exec(after)?.[1];
  if (value === undefined || hidden(value) || number(flat(value)) !== secondary) return undefined;
  for (const link of links) {
    if (!region.includes(link) || hidden(link) || daimlerElements(clean, hidden).some(parent => parent.includes(link))) return undefined;
    const href = attr(link.slice(0, link.indexOf(">") + 1), "href");
    if (href !== ORACLE_APPLY + secondary + "/apply/email") return undefined;
  }
  return { hasContainer: true, secondaryJobNumber: secondary };
}

/** Rebuild only validated identity proof plus the sole posting, never retain page text. */
export function daimlerEvidenceHtml(trusted: TrustedDaimlerVacancy): string {
  const script = '<script type="application/ld+json">' + JSON.stringify(trusted.posting).replace(/</gu, "\\u003c") + "</script>";
  if (!trusted.hasContainer) return script;
  const number = trusted.secondaryJobNumber;
  return '<div id="jobad-container" data-jobad-id="' + trusted.routeId + '">'
    + (number === undefined ? "" : '<h4>Job number:</h4><span>' + number + '</span><a href="' + ORACLE_APPLY + number + '/apply/email">Apply</a>')
    + script + '</div>';
}
