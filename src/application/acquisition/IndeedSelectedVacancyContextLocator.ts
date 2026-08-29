import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

const EVIDENCE = [
  "URL_EXTERNAL_ID",
  "MATCHING_SELECTED_RESULT",
  "BOUNDED_JOB_DETAIL",
  "DETAIL_EXTERNAL_ID_MATCH",
] as const;

export class IndeedSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "INDEED" || input.externalId === undefined) return undefined;
    if (!urlHasExternalId(input.sourceUrl, input.externalId)) return undefined;

    const selectedResults = findSelectedResults(input.html, input.externalId);
    if (selectedResults.length !== 1) return undefined;
    if (!containsMatchingJobKey(selectedResults[0]!, input.externalId)) return undefined;

    const details = findBoundedJobDetails(input.html);
    if (details.length !== 1) return undefined;
    const detailHtml = details[0]!;
    if (!detailIndependentlyReferencesId(detailHtml, input.externalId)) return undefined;

    const text = htmlToText(detailHtml);
    if (text.length === 0) return undefined;

    return createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "INDEED",
      providerExternalId: input.externalId,
      associationEvidence: EVIDENCE,
      text,
      html: detailHtml,
    });
  }
}

function urlHasExternalId(sourceUrl: string, externalId: string): boolean {
  try {
    return new URL(sourceUrl).searchParams.get("vjk") === externalId;
  } catch {
    return false;
  }
}

function findSelectedResults(html: string, externalId: string): string[] {
  const resultClass = `job_${externalId}`;
  const results: string[] = [];
  for (const match of openingTagMatches(html, "div")) {
    const tag = match[0];
    if (hasClass(tag, "result") && hasClass(tag, "vjs-highlight") && hasClass(tag, resultClass)) {
      const outerHtml = balancedElement(html, "div", match.index);
      if (outerHtml !== undefined) results.push(outerHtml);
    }
  }
  return results;
}

function containsMatchingJobKey(html: string, externalId: string): boolean {
  return openingTags(html, "a").some((tag) => attribute(tag, "data-jk") === externalId);
}

function findBoundedJobDetails(html: string): string[] {
  const details: string[] = [];
  for (const match of openingTagMatches(html, "section")) {
    const tag = match[0];
    if (
      attribute(tag, "id") === "job-full-details" &&
      hasClass(tag, "jobsearch-ViewJobContainerWrapper")
    ) {
      const outerHtml = balancedElement(html, "section", match.index);
      if (outerHtml !== undefined) details.push(outerHtml);
    }
  }
  return details;
}

function detailIndependentlyReferencesId(html: string, externalId: string): boolean {
  return openingTags(html, "a").some((tag) => {
    const href = attribute(tag, "href");
    if (href === undefined) return false;
    try {
      return new URL(href.replaceAll("&amp;", "&"), "https://indeed.com").searchParams.get("fromjk")
        === externalId;
    } catch {
      return false;
    }
  });
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
      .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>|<\/section\s*>/giu, "\n")
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
