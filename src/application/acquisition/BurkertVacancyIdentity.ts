import { createAcquisitionContext, type AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import { ConservativeProviderVacancyIdExtractor } from "./ConservativeProviderVacancyIdExtractor.js";
import { findJobPostingArticle } from "./SchemaOrgJobPostingExtractor.js";

export const BURKERT_SOURCE_NAME = "burkert.com";

const JOB_POSTING_ARTICLE = /<article\b[^>]*\bitemtype=["']https:\/\/schema\.org\/JobPosting["'][^>]*>/giu;

export type BurkertApplyIdentity =
  | { readonly kind: "NONE" }
  | { readonly kind: "ID"; readonly id: string }
  | { readonly kind: "CONFLICT" };

export function isBurkertSource(sourceName: string, sourceUrl: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return sourceName === BURKERT_SOURCE_NAME && (hostname === "burkert.com" || hostname === "www.burkert.com");
  } catch { return false; }
}

function applyIds(fragment: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of fragment.matchAll(/https?:\/\/[^"'\s<>]+\/apply(?:\?[^"'\s<>]*)?/giu)) {
    const id = /(?:^|[_-])(JR_\d+)(?:[/?#&_]|$)/iu.exec(match[0])?.[1];
    if (id !== undefined) ids.add(id.toUpperCase());
  }
  return [...ids];
}

/**
 * The apply-link requisition belonging to the vacancy: only IDs inside the single JobPosting article.
 * Links outside the article have no structural relationship to it and are ignored. A competing
 * article or several distinct IDs inside the article is a conflict and must fail closed.
 */
export function resolveBurkertApplyIdentity(html: string): BurkertApplyIdentity {
  const articleCount = [...html.matchAll(JOB_POSTING_ARTICLE)].length;
  if (articleCount > 1) return { kind: "CONFLICT" };
  if (articleCount === 0) return { kind: "NONE" };
  const article = findJobPostingArticle(html);
  if (article === undefined) return { kind: "CONFLICT" };
  const ids = applyIds(article);
  if (ids.length > 1) return { kind: "CONFLICT" };
  return ids.length === 1 ? { kind: "ID", id: ids[0]! } : { kind: "NONE" };
}

/** Source external ID for a Bürkert page; undefined when the page identity is ambiguous. */
export function resolveBurkertExternalId(html: string, routeId: string | undefined): string | undefined {
  const identity = resolveBurkertApplyIdentity(html);
  return identity.kind === "CONFLICT" ? undefined : identity.kind === "ID" ? identity.id : routeId;
}

/** The exact, unique JobPosting microdata article of a supported Bürkert vacancy route. */
export function locateBurkertVacancyContext(input: {
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly html: string;
}): AcquisitionContext | undefined {
  if (!isBurkertSource(input.sourceName, input.sourceUrl)) return undefined;
  const routeId = new ConservativeProviderVacancyIdExtractor().extract({ sourceName: input.sourceName, sourceUrl: input.sourceUrl });
  if (routeId === undefined) return undefined;
  if ([...input.html.matchAll(JOB_POSTING_ARTICLE)].length !== 1) return undefined;
  const article = findJobPostingArticle(input.html);
  const identity = resolveBurkertApplyIdentity(input.html);
  if (article === undefined || identity.kind === "CONFLICT") return undefined;
  const text = article.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]+>/gu, " ").replace(/&nbsp;/giu, " ").replace(/\s+/gu, " ").trim();
  if (text.length === 0) return undefined;
  return createAcquisitionContext({
    kind: "SELECTED_VACANCY",
    associationMethod: "PROVIDER_LOCATOR",
    html: article,
    text,
    providerExternalId: identity.kind === "ID" ? identity.id : routeId,
    associationEvidence: ["URL_SLUG_ROUTE", "UNIQUE_JOBPOSTING_ARTICLE", identity.kind === "ID" ? "APPLY_LINK_ID" : "SLUG_ID"],
  });
}