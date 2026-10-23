import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export const KELLY_WORKDAY_HOST = "kellyservices.wd503.myworkdayjobs.com";
export function isKellyWorkdaySource(sourceName: string, sourceUrl: string) {
  try { return sourceName === KELLY_WORKDAY_HOST && new URL(sourceUrl).hostname === KELLY_WORKDAY_HOST; } catch { return false; }
}
// Both requisition formats belong only to this validated corporate-careers tenant.
export function kellyVacancyId(value: string): string | undefined {
  try { const url = new URL(value); return url.hostname === KELLY_WORKDAY_HOST && ["http:", "https:"].includes(url.protocol)
    ? /^\/en-US\/corporatecareers-kellyservices-com\/details\/[^/]+_((?:JR)?\d+)\/?$/iu.exec(url.pathname)?.[1]?.toUpperCase() : undefined; } catch { return undefined; }
}
function linkedReference(value: string, sourceUrl: string) {
  try { const url = new URL(value, sourceUrl); return url.hostname === KELLY_WORKDAY_HOST
    ? /^\/en-US\/corporatecareers-kellyservices-com\/(?:details|job)\/[^/]+_((?:JR)?\d+)(?:\/apply)?\/?$/iu.exec(url.pathname)?.[1]?.toUpperCase() : undefined; } catch { return undefined; }
}
export function kellyElements(html: string, id: string) {
  return [...html.matchAll(/<([a-z][\w-]*)\b[^>]*>/giu)].flatMap(match => {
    if (!new RegExp(`\\bdata-automation-id=["']${id}["']`, "u").test(match[0])) return [];
    const tags = new RegExp(`<\\/?${match[1]}\\b[^>]*>`, "giu"); tags.lastIndex = match.index;
    let depth = 0;
    for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
      depth += tag[0].startsWith("</") ? -1 : 1;
      if (depth === 0) return [html.slice(match.index, tags.lastIndex)];
    }
    return [];
  });
}
/** Exclude only a structurally identified Similar Jobs section, never arbitrary
 * duplicate fields or links within the selected vacancy itself. */
function selectedKellyPane(pane: string): string | undefined {
  const headings = kellyElements(pane, "similar-jobs-heading");
  if (!headings.length) return pane;
  if (headings.length !== 1) return undefined;
  const headingAt = pane.indexOf(headings[0]!);
  const opening = [...pane.slice(0, headingAt).matchAll(/<section\b[^>]*>/giu)].at(-1);
  if (!opening) return undefined;
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
export function kellyFacts(html: string) {
  const selected = selectedKellyPane(html);
  if (selected === undefined) return undefined;
  html = selected;
  const headers = kellyElements(html, "jobPostingHeader"), descriptions = kellyElements(html, "jobPostingDescription");
  if (headers.length !== 1 || descriptions.length !== 1) return undefined;
  const title = text(headers[0]!), description = text(descriptions[0]!);
  if (!title || title.length > 200 || !description) return undefined;
  const values: Record<string, string> = {};
  for (const [id, label] of [["remoteType", "remote type"], ["locations", "locations"], ["time", "time type"], ["postedOn", "posted on"], ["requisitionId", "job requisition id"]]) {
    const fields = kellyElements(html, id!);
    if (fields.length > 1) return undefined;
    if (!fields.length) continue;
    const labels = [...fields[0]!.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>/giu)];
    const results = [...fields[0]!.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/giu)];
    if (labels.length !== 1 || results.length !== 1 || text(labels[0]![1]!).toLowerCase() !== label) return undefined;
    values[id!] = text(results[0]![1]!);
  }
  if (!/^(?:JR)?\d+$/iu.test(values.requisitionId ?? "") || !values.locations || /^(?:JR[-\w]*|\d+)$/iu.test(values.locations)) return undefined;
  const intro = /\b(Kelly)\s+is\s+(?:a team of experts|an equal opportunity employer)\b/iu.exec(description);
  // An employee's recruitment/client-service duties do not establish who is
  // hiring for this vacancy. Require a hiring statement or assignment context.
  const intermediary = [
    /\b(?:we|Kelly)\s+(?:(?:are|is)\s+)?(?:recruit(?:ing|s)?|hir(?:e|es|ing)|seek(?:ing|s)?|plac(?:e|es|ing))\b[^.!?\n]{0,100}\b(?:for|on behalf of)\s+our\s+client\b/iu,
    /\bour client\s+is\s+(?:hiring|recruiting|seeking|looking for)\b/iu,
    /\b(?:this|the|your)\s+(?:vacancy|role|position|job|opportunity)\s+(?:is|will be)\s+(?:an?\s+)?(?:(?:staffing|temporary)\s+)?assignment\s+(?:for|at|with)\b/iu,
    /\b(?:this|it)\s+(?:is|will be)\s+(?:an?\s+)?(?:(?:staffing|temporary)\s+)?assignment\s+(?:for|at|with)\b/iu,
    /\bwe\s+(?:have|offer|are offering)\s+(?:an?\s+)?(?:(?:staffing|temporary)\s+)?assignment\s+(?:for|at|with)\b/iu,
    /(?:^|[.!?\n])\s*(?:an?\s+)?(?:(?:staffing|temporary)\s+)?assignment\s+(?:for|at|with)\s+our\s+client\b/iu,
    /(?:^|[.!?\n])\s*(?:an?\s+)?(?:staffing|temporary)\s+assignment\s+(?:for|at|with)\b/iu,
  ].some(pattern => pattern.test(description));
  return { title, description, descriptionHtml: descriptions[0]!, values, name: intro?.[1], intermediary };
}
export class KellySelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = kellyVacancyId(input.sourceUrl);
    if (input.providerKey !== "KELLY_WORKDAY" || !id || (input.externalId !== undefined && input.externalId.toUpperCase() !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const panes = kellyElements(clean, "jobDetails");
    if (panes.length !== 1) return undefined;
    const pane = selectedKellyPane(panes[0]!);
    if (!pane) return undefined;
    const opening = pane.slice(0, pane.indexOf(">") + 1);
    if (/\baria-hidden=["']true["']|\s+hidden(?:[\s=>])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(opening) || /<(?:nav|aside|footer|form|input)\b/iu.test(pane)) return undefined;
    const facts = kellyFacts(pane);
    if (!facts || facts.values.requisitionId!.toUpperCase() !== id) return undefined;
    const actions = kellyElements(pane, "adventureButton").filter(action => /^Apply$/iu.test(text(action)));
    if (actions.length !== 1 || !/^<(?:a|button)\b/iu.test(actions[0]!)) return undefined;
    const applyUrl = /\bhref=["']([^"']+)["']/iu.exec(actions[0]!)?.[1];
    if (applyUrl && linkedReference(applyUrl, input.sourceUrl) !== id) return undefined;
    for (const link of pane.matchAll(/\bhref=["']([^"']+)["']/giu)) {
      const linked = linkedReference(link[1]!, input.sourceUrl); if (linked && linked !== id) return undefined;
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    for (const posting of postings) {
      const identifier = typeof posting.identifier === "object" && posting.identifier !== null ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      const reference = typeof identifier === "string" ? identifier.toUpperCase() : typeof identifier === "number" && Number.isSafeInteger(identifier) && identifier >= 0 ? String(identifier) : undefined;
      const linked = typeof posting.url === "string" ? linkedReference(posting.url, input.sourceUrl) : undefined;
      if ((reference === id || linked === id) && ((reference !== undefined && reference !== id) || (identifier !== undefined && reference === undefined) || (linked !== undefined && linked !== id))) return undefined;
    }
    // All normal fields come from the selected pane. Global tenant configuration,
    // result-list state and site branding do not supply organization or location.
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "KELLY_WORKDAY", providerExternalId: id,
      html: pane, text: [facts.title, ...Object.values(facts.values), facts.description].join("\n"),
      associationEvidence: ["BOUNDED_JOB_DETAIL", "KELLY_CORPORATE_CAREERS", "URL_EXTERNAL_ID", "PANE_REQUISITION_ID", "SELECTED_APPLY_ACTION"] });
  }
}
