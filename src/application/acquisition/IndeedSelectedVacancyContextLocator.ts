import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export class IndeedSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    if (input.providerKey !== "INDEED") return undefined;
    let sourceUrl: URL;
    try { sourceUrl = new URL(input.sourceUrl); } catch { return undefined; }
    if (!isIndeedHostname(sourceUrl.hostname)) return undefined;
    const html = stripIndeedScripts(input.html);
    const companyJobs = isIndeedCompanyJobsUrl(input.sourceUrl);
    const directView = sourceUrl.pathname === "/viewjob";
    const details = findBoundedJobDetails(html, companyJobs, directView);
    if (details.length !== 1) return undefined;
    const detailHtml = details[0]!;
    const detailIds = explicitDetailIds(detailHtml, input.sourceUrl);
    if (detailIds.size > 1) return undefined;
    const companyPane = companyJobs && /data-testid\s*=\s*["']JobDetail["']/u.test(detailHtml);
    const nativePane = /data-testid\s*=\s*["']viewjob-main-content["']/iu.test(detailHtml);
    const urlId = indeedUrlVacancyId(input.sourceUrl);
    const externalId = [...detailIds][0] ?? (companyPane || (directView && nativePane) ? urlId : undefined);
    if (externalId === undefined) return undefined;
    const urlKeys = [...sourceUrl.searchParams.getAll("vjk"), ...(supportsJkQuery(sourceUrl) ? sourceUrl.searchParams.getAll("jk") : [])].filter(Boolean);
    if (urlKeys.some((key) => key !== externalId)) return undefined;
    if ((input.externalId !== undefined && input.externalId !== externalId)
      || (urlId !== undefined && urlId !== externalId)) return undefined;
    const selectedResults = findSelectedResults(html);
    // Legacy panes require the independent selected-card association. Native
    // direct pages may instead use the explicit URL key after bounding the job.
    if ((!nativePane && !companyPane && selectedResults.length !== 1) || selectedResults.length > 1) return undefined;
    if (selectedResults.some((card) => !hasClass(openingTags(card, "div")[0] ?? "", `job_${externalId}`)
      || !containsMatchingJobKey(card, externalId))) return undefined;

    const text = htmlToIndeedText(detailHtml);
    if (text.length === 0) return undefined;

    return createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "INDEED",
      providerExternalId: externalId,
      associationEvidence: [
        urlId === undefined ? "SELECTED_DETAIL_EXTERNAL_ID" : "URL_EXTERNAL_ID",
        ...(selectedResults.length === 1 ? ["MATCHING_SELECTED_RESULT"] : []),
        "BOUNDED_JOB_DETAIL",
        ...(directView && nativePane ? ["INDEED_DIRECT_JOB_HEADER_AND_CONTENT"] : []),
        ...(detailIds.size === 1 ? ["DETAIL_EXTERNAL_ID_MATCH"] : []),
      ],
      text,
      html: detailHtml,
    });
  }
}

export function indeedUrlVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    if (!isIndeedHostname(url.hostname)) return undefined;
    const values = [...url.searchParams.getAll("vjk"), ...(supportsJkQuery(url) ? url.searchParams.getAll("jk") : [])].filter(Boolean);
    return new Set(values).size === 1 ? values[0] : undefined;
  } catch { return undefined; }
}

export function isIndeedCompanyJobsUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return isIndeedHostname(url.hostname) && /^\/cmp\/[^/]+\/jobs\/?$/u.test(url.pathname);
  } catch { return false; }
}

function supportsJkQuery(url: URL): boolean {
  return url.pathname === "/viewjob" || isIndeedCompanyJobsUrl(url.href);
}

export function requiresIndeedSelectedContext(sourceUrl: string, html = ""): boolean {
  try {
    const url = new URL(sourceUrl);
    if (!isIndeedHostname(url.hostname)) return false;
    return url.pathname === "/" || url.pathname === "/jobs" || url.pathname === "/viewjob" || isIndeedCompanyJobsUrl(sourceUrl)
      || /(?:job-full-details|jobsearch-ViewjobPaneWrapper|rnvjContainerDesktop|viewjob-main-content|vjs-highlight)/u.test(stripIndeedScripts(html));
  } catch { return false; }
}

function findSelectedResults(html: string): string[] {
  const results: string[] = [];
  for (const match of openingTagMatches(html, "div")) {
    const tag = match[0];
    if (hasClass(tag, "result") && hasClass(tag, "vjs-highlight")) {
      const outerHtml = balancedElement(html, "div", match.index);
      if (outerHtml !== undefined) results.push(outerHtml);
    }
  }
  return results;
}

function containsMatchingJobKey(html: string, externalId: string): boolean {
  return openingTags(html, "a").some((tag) => attribute(tag, "data-jk") === externalId);
}

function findBoundedJobDetails(html: string, companyJobs: boolean, directView: boolean): string[] {
  if (directView) {
    const mains = indeedElementsWithAttribute(html, "data-testid", "viewjob-main-content");
    if (mains.length > 0) return boundDirectJob(mains);
  }
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
  const wrappers = indeedElementsWithAttribute(html, "id", "jobsearch-ViewjobPaneWrapper");
  for (const wrapper of wrappers) {
    const main = indeedElementsWithAttribute(wrapper, "data-testid", "viewjob-main-content");
    if (main.length !== 1 || indeedElementsWithAttribute(main[0]!, "data-testid", "vj-job-title").length !== 1
      || indeedElementsWithAttribute(main[0]!, "data-testid", "viewjob-job-content").length !== 1) return [];
    details.push(main[0]!);
  }
  if (companyJobs) {
    for (const pane of indeedElementsWithAttribute(html, "data-testid", "JobDetail")) {
      const head = indeedElementsWithAttribute(pane, "data-testid", "JobDetailHead");
      if (head.length !== 1 || indeedElementsWithAttribute(head[0]!, "data-testid", "jobDetailTitle").length !== 1
        || indeedElementsWithAttribute(head[0]!, "data-testid", "jobDetailSubtitle").length !== 1
        || indeedElementsWithAttribute(pane, "data-testid", "jobDetailDescription").length !== 1
        || indeedElementsWithAttribute(pane, "data-testid", "JobList").length !== 0) return [];
      details.push(pane);
    }
  }
  return details;
}

function boundDirectJob(mains: readonly string[]): string[] {
  if (mains.length !== 1) return [];
  const main = mains[0]!;
  const headers = indeedElementsWithAttribute(main, "data-testid", "desktop-job-header");
  const contents = indeedElementsWithAttribute(main, "data-testid", "viewjob-job-content");
  if (headers.length !== 1 || contents.length !== 1
    || indeedElementsWithAttribute(headers[0]!, "data-testid", "vj-job-title").length !== 1
    || indeedElementsWithAttribute(headers[0]!, "data-testid", "company-info-metadata").length !== 1
    || indeedElementsWithAttribute(contents[0]!, "data-testid", "vj-job-title").length !== 0
    || headers[0]!.includes(contents[0]!) || contents[0]!.includes(headers[0]!)) return [];
  const bounded = headers[0]! + contents[0]!;
  // Reject embedded navigation/cards rather than broadening the text scope.
  if (/<(?:aside|nav|footer)\b/iu.test(bounded)
    || /\sdata-testid\s*=\s*["'](?:JobList|JobDetail|job-card|standalone-desktop-search-page)["']/iu.test(bounded)
    || openingTags(bounded, "div").some((tag) => hasClass(tag, "result"))) return [];
  // Keep the container's identity attributes, but discard its search form,
  // recommendations, account controls, and other sibling content.
  const opening = /^<([a-z][\w-]*)\b[^>]*>/iu.exec(main)!;
  return [`${opening[0]}${bounded}</${opening[1]!}>`];
}

function explicitDetailIds(html: string, sourceUrl: string): Set<string> {
  const ids = new Set<string>();
  for (const tag of html.match(/<[a-z][\w-]*\b[^>]*>/giu) ?? []) {
    for (const name of ["data-jk", "data-job-key", "data-indeed-apply-jk"]) {
      const id = attribute(tag, name);
      if (id) ids.add(id);
    }
    for (const name of ["data-indeed-apply-joburl", "data-indeed-apply-continueurl", "data-indeed-apply-pingbackurl"]) {
      const href = attribute(tag, name);
      if (href !== undefined) addUrlIds(href);
    }
  }
  for (const tag of openingTags(html, "a")) {
    const href = attribute(tag, "href");
    if (href === undefined) continue;
    addUrlIds(href);
  }
  return ids;

  function addUrlIds(href: string): void {
    // A button's empty/fragment href inherits the browser URL; it is not an
    // independent identifier exposed by the selected detail.
    if (href.trim() === "" || href.trim().startsWith("#")) return;
    try {
      const url = new URL(href.replaceAll("&amp;", "&"), sourceUrl);
      if (!isIndeedHostname(url.hostname) || !["http:", "https:"].includes(url.protocol)) return;
      for (const key of ["jk", "vjk", "fromjk"]) for (const value of url.searchParams.getAll(key)) if (value) ids.add(value);
      // Current native Indeed apply links carry the selected key in an explicit
      // Indeed conversion URL, not in the opaque applyable-job UUID.
      if (url.hostname === "smartapply.indeed.com" && url.pathname === "/beta/indeedapply/applybyapplyablejobid") {
        const pingback = url.searchParams.get("pingbackUrl");
        if (pingback) {
          const nested = new URL(pingback);
          if (isIndeedHostname(nested.hostname) && ["http:", "https:"].includes(nested.protocol)) {
            for (const value of nested.searchParams.getAll("jk")) if (value) ids.add(value);
          }
        }
      }
    } catch { /* Ignore malformed or non-provider links. */ }
  }
}

function isIndeedHostname(hostname: string): boolean { return hostname === "indeed.com" || hostname.endsWith(".indeed.com"); }

export function stripIndeedScripts(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "").replace(/<!--[\s\S]*?-->/gu, "");
}

export function indeedElementsWithAttribute(html: string, name: string, value: string): string[] {
  const result: string[] = [];
  for (const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/giu)) {
    if (attribute(match[0], name) !== value) continue;
    const element = balancedElement(html, match[1]!, match.index);
    if (element !== undefined) result.push(element);
  }
  return result;
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

export function htmlToIndeedText(html: string): string {
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
