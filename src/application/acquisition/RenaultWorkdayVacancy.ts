import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { kellyElements as elements } from "./KellyWorkdayVacancy.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export const RENAULT_WORKDAY_HOST = "alliancewd.wd3.myworkdayjobs.com";
export function isRenaultWorkdaySource(sourceName: string, sourceUrl: string): boolean {
  try { const url = new URL(sourceUrl); return sourceName === RENAULT_WORKDAY_HOST && url.hostname === sourceName
    && /^\/[^/]+\/renault-group-careers(?:\/|$)/u.test(url.pathname); } catch { return false; }
}
export function renaultVacancyId(value: string, base?: string): string | undefined {
  try { const url = new URL(value, base); return url.hostname === RENAULT_WORKDAY_HOST && ["http:", "https:"].includes(url.protocol)
    ? /^\/fr-FR\/renault-group-careers\/(?:job\/(?:[^/]+\/)?|details\/)[^/]+_(JOBREQ_\d+)\/?$/u.exec(url.pathname)?.[1] : undefined; } catch { return undefined; }
}
/** Route syntax is not sufficient evidence to normalize a requisition. Keep
 * the discriminator in the external identity; suffixed routes are promoted
 * only by the locator after independent DOM, canonical and JSON-LD agreement. */
export function renaultRouteIdentity(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (url.hostname !== RENAULT_WORKDAY_HOST || !["http:", "https:"].includes(url.protocol)) return undefined;
    const match = /^\/fr-FR\/renault-group-careers\/(?:job\/(?:[^/]+\/)?|details\/)[^/]+_((JOBREQ_\d+)(?:-([1-9]\d*))?)\/?$/u.exec(url.pathname);
    return match ? { routeId: match[1]!, requisitionId: match[2]!, suffix: match[3] } : undefined;
  } catch { return undefined; }
}
function linkedId(value: string, base: string) { return renaultRouteIdentity(value.replace(/\/+apply(?=[?#]|$)/u, ""), base)?.routeId; }
export function renaultPublishedAt(metadata: Readonly<Record<string, unknown>> | undefined): Date | undefined {
  const value = metadata?.datePosted;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined;
}
export function renaultFacts(html: string) {
  const headings = elements(html, "jobPostingHeader"), descriptions = elements(html, "jobPostingDescription");
  if (headings.length !== 1 || descriptions.length !== 1) return undefined;
  const title = text(headings[0]!).replace(/\s+/gu, " "), description = text(descriptions[0]!);
  if (!title || title.length > 200 || !description || /page is loaded/iu.test(title)) return undefined;
  const fields: string[] = [], values: Record<string, string> = {};
  for (const [id, label] of [["locations", "locations"], ["time", "time type"], ["postedOn", "posted on"], ["timeLeftToApply", "time left to apply"], ["requisitionId", "job requisition id"]]) {
    const found = elements(html, id!);
    if (found.length > 1) return undefined;
    if (!found.length) continue;
    const dt = [...found[0]!.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>/giu)], dd = [...found[0]!.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/giu)];
    if (dt.length !== 1 || dd.length !== 1 || text(dt[0]![1]!) !== label) return undefined;
    values[id!] = text(dd[0]![1]!); fields.push(found[0]!);
  }
  if (!/^JOBREQ_\d+$/u.test(values.requisitionId ?? "") || !values.locations) return undefined;
  const company = /^Société\s*:?\s*\n([^\n]+)\nDescriptif du poste/u.exec(description)?.[1]?.trim();
  return { title, description, company, values, html: [headings[0]!, ...fields, descriptions[0]!].join("\n") };
}

/** Related cards are siblings after the selected details, not part of its
 * description. Never hide duplicate fields or conflicting links inside the
 * selected details merely because they carry a related-card marker. */
function withoutSimilarJobs(page: string, sourceUrl: string): string | undefined {
  const cards = elements(page, "similarJobsCard");
  if (!cards.length) return page;
  const headings = elements(page, "similar-jobs-heading"), details = elements(page, "job-posting-details");
  if (headings.length !== 1 || details.length !== 1) return undefined;
  const detailsEnd = page.indexOf(details[0]!) + details[0]!.length;
  const headingAt = page.indexOf(headings[0]!);
  if (headingAt < detailsEnd) return undefined;
  for (const card of cards) {
    if (page.indexOf(card) < headingAt + headings[0]!.length
      || /\bdata-automation-id=["'](?:jobPostingPage|job-posting-details|jobPostingHeader|jobPostingDescription|requisitionId|adventureButton)["']/u.test(card)
      || elements(card, "similarJobsCard").length !== 1) return undefined;
    const links = [...card.matchAll(/\bhref=["']([^"']+)["']/gu)];
    if (links.length !== 1 || !renaultRouteIdentity(links[0]![1]!, sourceUrl)) return undefined;
  }
  for (const card of cards) page = page.replace(card, "");
  return page;
}

/** The split-view pane has a nested related-jobs section (not standalone
 * similarJobsCard elements). Exclude only that identified section, after the
 * complete description; never truncate a scroll container or skip arbitrary
 * duplicate fields/links within the selected vacancy. */
function withoutPaneSimilarJobs(pane: string): string | undefined {
  const headings = elements(pane, "similar-jobs-heading");
  if (!headings.length) return pane;
  const descriptions = elements(pane, "jobPostingDescription");
  if (headings.length !== 1 || descriptions.length !== 1) return undefined;
  const headingAt = pane.indexOf(headings[0]!);
  const opening = [...pane.slice(0, headingAt).matchAll(/<section\b[^>]*>/giu)].at(-1);
  if (!opening || opening.index < pane.indexOf(descriptions[0]!) + descriptions[0]!.length) return undefined;
  const tags = /<\/?section\b[^>]*>/giu;
  tags.lastIndex = opening.index;
  let depth = 0;
  for (let tag = tags.exec(pane); tag; tag = tags.exec(pane)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth !== 0) continue;
    const module = pane.slice(opening.index, tags.lastIndex);
    if (!module.includes(headings[0]!) || !/<ul\b[^>]*\baria-label=["']Similar jobs["']/iu.test(module)
      || /\bdata-automation-id=["'](?:jobDetails|jobPostingHeader|jobPostingDescription|requisitionId|adventureButton)["']/iu.test(module)) return undefined;
    return pane.slice(0, opening.index) + pane.slice(tags.lastIndex);
  }
  return undefined;
}

export class RenaultSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const route = renaultRouteIdentity(input.sourceUrl);
    if (input.providerKey !== "RENAULT_WORKDAY" || !route || (input.externalId !== undefined && input.externalId !== route.routeId)) return undefined;
    const id = route.routeId, requisitionId = route.requisitionId;
    const splitView = new URL(input.sourceUrl).pathname.startsWith("/fr-FR/renault-group-careers/details/");
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const boundary = splitView ? "jobDetails" : "jobPostingPage";
    const pages = elements(clean, boundary);
    if (pages.length !== 1) return undefined;
    // The page also contains an alert and a marketing sidebar. Select only the
    // heading, labeled facts and complete description from its vacancy body.
    let page = pages[0]!;
    const opening = page.slice(0, page.indexOf(">") + 1);
    if (/\b(?:hidden|aria-hidden=["']true["'])/u.test(opening) || /\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(opening)) return undefined;
    if (splitView && (!/^<section\b/iu.test(opening) || /<(?:nav|aside|footer|form|input)\b/iu.test(page))) return undefined;
    for (const sidebar of elements(page, "jobSidebar")) page = page.replace(sidebar, "");
    const bounded = splitView ? withoutPaneSimilarJobs(page) : withoutSimilarJobs(page, input.sourceUrl);
    if (bounded === undefined) return undefined;
    page = bounded;
    const facts = renaultFacts(page);
    if (!facts || facts.values.requisitionId !== requisitionId) return undefined;
    const actions = elements(page, "adventureButton");
    if (actions.length !== 1 || text(actions[0]!) !== "Postuler") return undefined;
    const apply = /\bhref=["']([^"']+)["']/u.exec(actions[0]!)?.[1];
    if (!apply || linkedId(apply, input.sourceUrl) !== id) return undefined;
    for (const link of page.matchAll(/\bhref=["']([^"']+)["']/gu)) {
      let url: URL;
      try { url = new URL(link[1]!, input.sourceUrl); } catch { return undefined; }
      if (isRenaultWorkdaySource(url.hostname, url.href) && /\/(?:job|details)\//u.test(url.pathname) && linkedId(url.href, input.sourceUrl) !== id) return undefined;
    }
    let canonicalSeen = false;
    for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
      if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/u.test(tag[0])) continue;
      const url = /\b(?:href|content)=["']([^"']+)["']/u.exec(tag[0])?.[1];
      // Workday keeps stale document-level metadata when a result opens in a
      // split pane. Only metadata independently tied to this selection applies.
      if (splitView && (!url || renaultRouteIdentity(url, input.sourceUrl)?.requisitionId !== requisitionId)) continue;
      if (!url || renaultRouteIdentity(url, input.sourceUrl)?.routeId !== id) return undefined;
      if (/\brel=["']canonical["']/u.test(tag[0])) canonicalSeen = true;
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    const matched = postings.filter(posting => {
      const identifier = typeof posting.identifier === "object" && posting.identifier !== null ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      return identifier === requisitionId || (typeof posting.url === "string" && renaultRouteIdentity(posting.url, input.sourceUrl)?.routeId === id) || (!splitView && postings.length === 1);
    });
    if (matched.length > 1) return undefined;
    for (const posting of matched) {
      const identifier = typeof posting.identifier === "object" && posting.identifier !== null ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      if ((identifier !== undefined && identifier !== requisitionId) || (posting.url !== undefined && (typeof posting.url !== "string" || renaultRouteIdentity(posting.url, input.sourceUrl)?.routeId !== id))) return undefined;
      if (route.suffix !== undefined && identifier !== requisitionId) return undefined;
    }
    if (route.suffix !== undefined && (!canonicalSeen || matched.length !== 1)) return undefined;
    const posting = matched[0];
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "RENAULT_WORKDAY", providerExternalId: id,
      html: splitView ? `<section data-automation-id="jobDetails">${facts.html}\n${actions[0]!}</section>` : `<div data-automation-id="jobPostingPage">${facts.html}\n${actions[0]!}</div>`,
      text: [facts.title, ...Object.values(facts.values), facts.description].join("\n"),
      metadata: { branding: elements(clean, "headerTitle").some(header => /^Careers\s*\|\s*Renault Group$/u.test(text(header))) ? "Renault Group" : undefined,
        routeId: id, requisitionId, ...(route.suffix === undefined ? {} : { routeSuffix: route.suffix }),
        displayedLocation: facts.values.locations, structuredLocation: posting?.jobLocation,
        publicationRelativeText: facts.values.postedOn, applicationDeadlineText: facts.values.timeLeftToApply,
        datePosted: posting?.datePosted, validThrough: posting?.validThrough },
      associationEvidence: ["BOUNDED_JOB_DETAIL", "RENAULT_GROUP_CAREERS", "URL_EXTERNAL_ID", "PANE_REQUISITION_ID", "SELECTED_APPLY_ACTION"] });
  }
}
