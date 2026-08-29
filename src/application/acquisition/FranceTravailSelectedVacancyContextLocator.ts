import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

const EVIDENCE = [
  "URL_EXTERNAL_ID",
  "MATCHING_ACTIVE_RESULT",
  "OPEN_OFFER_DETAIL",
  "DETAIL_EXTERNAL_ID_MATCH",
] as const;

export class FranceTravailSelectedVacancyContextLocator
  implements SelectedVacancyContextLocator
{
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "FRANCE_TRAVAIL" || input.externalId === undefined) {
      return undefined;
    }
    if (!urlHasExternalId(input.sourceUrl, input.externalId)) return undefined;
    if (!hasMatchingActiveResult(input.html, input.externalId)) return undefined;

    const detailCandidates = findOpenOfferDetailContexts(input.html);
    if (detailCandidates.length !== 1) return undefined;
    const detailHtml = detailCandidates[0]!;
    if (!detailIndependentlyReferencesId(detailHtml, input.externalId)) return undefined;

    const text = htmlToText(detailHtml);
    if (text.length === 0) return undefined;

    return createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "FRANCE_TRAVAIL",
      providerExternalId: input.externalId,
      associationEvidence: EVIDENCE,
      text,
      html: detailHtml,
    });
  }
}

function urlHasExternalId(sourceUrl: string, externalId: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return /^\/offres\/recherche\/detail\/([0-9A-Z]+)\/?$/u.exec(url.pathname)?.[1]
      === externalId;
  } catch {
    return false;
  }
}

function hasMatchingActiveResult(html: string, externalId: string): boolean {
  return openingTags(html, "li").some((tag) =>
    attribute(tag, "data-id-offre") === externalId && hasClass(tag, "active"));
}

function findOpenOfferDetailContexts(html: string): string[] {
  const candidates: string[] = [];
  for (const match of openingTagMatches(html, "div")) {
    const tag = match[0];
    if (
      attribute(tag, "id") === "PopinDetails" &&
      hasClass(tag, "modal-details-offre") &&
      hasClass(tag, "in")
    ) {
      const outerHtml = balancedElement(html, "div", match.index);
      if (outerHtml !== undefined) candidates.push(outerHtml);
    }
  }
  return candidates;
}

function detailIndependentlyReferencesId(html: string, externalId: string): boolean {
  const escaped = escapeRegExp(externalId);
  const headingMatch = new RegExp(
    `<h[1-6]\\b[^>]*>[\\s\\S]*?Offre\\s+(?:n(?:°|&deg;|&#176;)\\s*)?${escaped}\\b[\\s\\S]*?<\\/h[1-6]>`,
    "iu",
  ).test(html);
  const actionLinkMatch = openingTags(html, "a").some((tag) => {
    const href = attribute(tag, "href");
    if (href === undefined) return false;
    return new RegExp(`(?:[?&]|&amp;)idOffre=${escaped}(?:[&#]|&amp;|$)`, "u").test(href);
  });
  return headingMatch || actionLinkMatch;
}

function openingTags(html: string, tagName: string): string[] {
  return openingTagMatches(html, tagName).map((match) => match[0]);
}

function openingTagMatches(html: string, tagName: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "giu");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) matches.push(match);
  return matches;
}

function balancedElement(html: string, tagName: string, start: number): string | undefined {
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "giu");
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    if (match.index === start || !match[0].startsWith("</")) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2];
}

function hasClass(tag: string, className: string): boolean {
  return attribute(tag, "class")?.split(/\s+/u).includes(className) ?? false;
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  ).replace(/[ \t]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}

function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"', deg: "°",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLocaleLowerCase()] ?? entity;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
