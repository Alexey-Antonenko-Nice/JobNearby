import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

const LINK_EVIDENCE = [
  "URL_EXTERNAL_ID",
  "MATCHING_JOB_DETAILS",
  "BOUNDED_JOB_DETAIL",
  "MATCHING_LINKEDIN_JOB_LINK",
] as const;

const COMPONENT_EVIDENCE = [
  "URL_EXTERNAL_ID",
  "MATCHING_JOB_DETAILS",
  "BOUNDED_JOB_DETAIL",
  "MATCHING_LINKEDIN_COMPONENT_REFERENCE",
] as const;

interface ElementFragment {
  readonly start: number;
  readonly html: string;
}

export class LinkedInSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "LINKEDIN" || input.externalId === undefined) return undefined;
    if (!urlHasExternalId(input.sourceUrl, input.externalId)) return undefined;

    const primaryDetails = findPrimaryJobDetails(input.html);
    if (primaryDetails.length !== 1 || primaryDetails[0]!.externalId !== input.externalId) {
      return undefined;
    }
    const primary = primaryDetails[0]!;

    const matchingLinkExists = containsMatchingJobLink(input.html, input.externalId);
    const matchingComponentExists = containsMatchingComponentReference(input.html, input.externalId);
    if (!matchingLinkExists && !matchingComponentExists) return undefined;

    const linkedWrapper = matchingLinkExists
      ? findUniqueLinkedDetailWrapper(input.html, primary.fragment, input.externalId)
      : undefined;
    if (matchingLinkExists && linkedWrapper === undefined) return undefined;
    if (!matchingLinkExists && !matchingComponentExists) return undefined;
    const boundedHtml = linkedWrapper?.html ?? primary.fragment.html;
    if (containsCompetingJobDetailsId(boundedHtml, input.externalId)) return undefined;

    const text = htmlToText(boundedHtml);
    if (text.length === 0) return undefined;

    return createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "LINKEDIN",
      providerExternalId: input.externalId,
      associationEvidence: linkedWrapper === undefined ? COMPONENT_EVIDENCE : LINK_EVIDENCE,
      text,
      html: boundedHtml,
    });
  }
}

function urlHasExternalId(sourceUrl: string, externalId: string): boolean {
  try {
    return new URL(sourceUrl).searchParams.get("currentJobId") === externalId;
  } catch {
    return false;
  }
}

function findPrimaryJobDetails(html: string): Array<{
  readonly externalId: string;
  readonly fragment: ElementFragment;
}> {
  const details: Array<{ externalId: string; fragment: ElementFragment }> = [];
  for (const match of openingTagMatches(html, "div")) {
    const id = attribute(match[0], "id");
    const externalId = id === undefined
      ? undefined
      : /^JobDetails_AboutTheJob_(\d+)$/u.exec(id)?.[1];
    if (externalId === undefined) continue;
    const elementHtml = balancedElement(html, "div", match.index);
    if (elementHtml !== undefined) {
      details.push({ externalId, fragment: { start: match.index, html: elementHtml } });
    }
  }
  return details;
}

function containsMatchingJobLink(html: string, externalId: string): boolean {
  return openingTags(html, "a").some((tag) => {
    const href = attribute(tag, "href");
    if (href === undefined) return false;
    try {
      const pathname = new URL(href.replaceAll("&amp;", "&"), "https://linkedin.com").pathname;
      return new RegExp(`^/jobs/view/${escapeRegExp(externalId)}(?:/|$)`, "u").test(pathname);
    } catch {
      return false;
    }
  });
}

function containsMatchingComponentReference(html: string, externalId: string): boolean {
  const expected = `job-card-component-ref-${externalId}`;
  return openingTags(html, "div").some((tag) => attribute(tag, "componentkey") === expected);
}

function findUniqueLinkedDetailWrapper(
  html: string,
  primary: ElementFragment,
  externalId: string,
): ElementFragment | undefined {
  const candidates: ElementFragment[] = [];
  const pageMatchingLinkCount = matchingJobLinkCount(html, externalId);
  for (const match of openingTagMatches(html, "div")) {
    if (match.index > primary.start) break;
    const elementHtml = balancedElement(html, "div", match.index);
    if (
      elementHtml !== undefined &&
      containsPrimaryJobDetails(elementHtml, externalId) &&
      matchingJobLinkCount(elementHtml, externalId) === pageMatchingLinkCount &&
      !containsCompetingJobLink(elementHtml, externalId) &&
      isDefensibleDetailBoundary(elementHtml, externalId)
    ) {
      candidates.push({ start: match.index, html: elementHtml });
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isDefensibleDetailBoundary(html: string, externalId: string): boolean {
  if (containsAnyJobCardComponentReference(html)) return false;
  const children = directChildDivs(html);
  if (children.length !== 2) return false;

  const primaryBranches = children.filter((child) => containsPrimaryJobDetails(child, externalId));
  const linkBranches = children.filter((child) => containsMatchingJobLink(child, externalId));
  if (primaryBranches.length !== 1 || linkBranches.length !== 1) return false;
  if (primaryBranches[0] === linkBranches[0]) return false;
  return matchingJobDetailsCount(primaryBranches[0]!, externalId) >= 2;
}

function directChildDivs(html: string): string[] {
  const children: string[] = [];
  const tags = /<\/?div\b[^>]*>/giu;
  let depth = 0;
  let childStart: number | undefined;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    const closing = match[0].startsWith("</");
    if (!closing) {
      if (depth === 1) childStart = match.index;
      depth += 1;
      continue;
    }
    if (depth === 2 && childStart !== undefined) {
      children.push(html.slice(childStart, tags.lastIndex));
      childStart = undefined;
    }
    depth -= 1;
  }
  return children;
}

function matchingJobDetailsCount(html: string, externalId: string): number {
  return openingTags(html, "div").filter((tag) => {
    const id = attribute(tag, "id");
    return id?.startsWith("JobDetails_") === true && /_(\d+)$/u.exec(id)?.[1] === externalId;
  }).length;
}

function matchingJobLinkCount(html: string, externalId: string): number {
  return openingTags(html, "a").filter((tag) => {
    const href = attribute(tag, "href");
    if (href === undefined) return false;
    try {
      const pathname = new URL(href.replaceAll("&amp;", "&"), "https://linkedin.com").pathname;
      return new RegExp(`^/jobs/view/${escapeRegExp(externalId)}(?:/|$)`, "u").test(pathname);
    } catch {
      return false;
    }
  }).length;
}

function containsAnyJobCardComponentReference(html: string): boolean {
  return openingTags(html, "div").some((tag) =>
    attribute(tag, "componentkey")?.startsWith("job-card-component-ref-") === true);
}

function containsPrimaryJobDetails(html: string, externalId: string): boolean {
  const expected = `JobDetails_AboutTheJob_${externalId}`;
  return openingTags(html, "div").some((tag) => attribute(tag, "id") === expected);
}

function containsCompetingJobLink(html: string, externalId: string): boolean {
  for (const tag of openingTags(html, "a")) {
    const href = attribute(tag, "href");
    if (href === undefined) continue;
    try {
      const pathname = new URL(href.replaceAll("&amp;", "&"), "https://linkedin.com").pathname;
      const linkedId = /^\/jobs\/view\/(\d+)(?:\/|$)/u.exec(pathname)?.[1];
      if (linkedId !== undefined && linkedId !== externalId) return true;
    } catch {
      // Ignore unrelated malformed links.
    }
  }
  return false;
}

function containsCompetingJobDetailsId(html: string, externalId: string): boolean {
  for (const tag of openingTags(html, "div")) {
    const id = attribute(tag, "id");
    if (id === undefined || !id.startsWith("JobDetails_")) continue;
    const identifiedId = /_(\d+)$/u.exec(id)?.[1];
    if (identifiedId !== undefined && identifiedId !== externalId) return true;
  }
  return false;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
