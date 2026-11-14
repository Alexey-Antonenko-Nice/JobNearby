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
export function trustedDaimlerJobPosting(input: {
  sourceName: string; sourceUrl?: string; externalId?: string; html?: string;
}): RawSchemaOrgJobPosting | undefined {
  if (input.sourceName !== DAIMLER_TRUCK_SOURCE || input.html === undefined) return undefined;
  const id = daimlerTruckRouteId(input.sourceUrl ?? "");
  if (id === undefined || input.externalId !== id) return undefined;
  const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
  if (postings.length !== 1) return undefined;
  const posting = postings[0]!;
  const title = typeof posting.title === "string" ? posting.title.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
  if (title.length < 5 || title.length > 250
    || /^(?:search|search jobs|job search|jobs?|careers?|vacancies|offres? d['’]emploi|recherche d['’]emploi)$/iu.test(title)) return undefined;
  // Preserve existing supported identifier forms. Real numeric PropertyValue IDs
  // differ from route IDs; do not assume they are aliases or silently discard them.
  if (posting.identifier !== undefined) {
    const identifier = typeof posting.identifier === "string" ? posting.identifier : record(posting.identifier)?.value;
    if (identifier !== id) return undefined;
  }
  if (posting.url !== undefined
    && (typeof posting.url !== "string" || daimlerTruckRouteId(posting.url) !== id)) return undefined;
  // Existing route-only fixtures remain supported when BOTH structured signals are absent.
  return posting;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
