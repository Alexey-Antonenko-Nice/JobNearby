import { createAcquisitionContext, type AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";
import { randstadText } from "./RandstadVacancy.js";

export const AIRBUS_WORKDAY_HOST = "ag.wd3.myworkdayjobs.com";
export function isAirbusWorkdaySource(sourceName: string, sourceUrl: string): boolean {
  try { return sourceName === AIRBUS_WORKDAY_HOST && new URL(sourceUrl).hostname === AIRBUS_WORKDAY_HOST; }
  catch { return false; }
}
/** Route syntax yields a candidate, not permission to normalize or publish an identity. */
export function airbusDirectRoute(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== AIRBUS_WORKDAY_HOST || !["http:", "https:"].includes(url.protocol)
      || url.username || url.password || url.port) return undefined;
    const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?airbus\/job\/[^/]+\/[^/]+_((JR[1-9]\d*)(-1)?)\/?$/iu.exec(url.pathname);
    return match ? { routeId: match[1]!.toUpperCase(), requisitionId: match[2]!.toUpperCase(), suffixed: match[3] !== undefined } : undefined;
  } catch { return undefined; }
}
interface Node { tag: string; attrs: Map<string, string>; children: (Node | string)[]; parent?: Node }
const voidTags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const decode = (value: string) => randstadText(value);
const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
/** Browser-serialized, balanced markup only. Never repair ambiguous ownership. */
function parse(html: string): Node | undefined {
  const root: Node = { tag: "root", attrs: new Map(), children: [] }, stack = [root];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
  let end = 0;
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    const literal = html.slice(end, match.index);
    if (literal.includes("<") || stack.length > 256) return undefined;
    stack.at(-1)!.children.push(literal); end = tokens.lastIndex;
    const token = match[0];
    if (token.startsWith("<!")) continue;
    const tag = /^<\/?([\w:-]+)/u.exec(token)![1]!.toLowerCase();
    if (token.startsWith("</")) {
      if (stack.length === 1 || stack.at(-1)!.tag !== tag) return undefined;
      stack.pop(); continue;
    }
    const attrs = new Map<string, string>(), body = token.slice(tag.length + 1, -1).replace(/\/$/u, "");
    const pattern = /\s+([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'=]+)))?/gu;
    let offset = 0;
    for (const attr of body.matchAll(pattern)) {
      if (body.slice(offset, attr.index).trim()) return undefined;
      const name = attr[1]!.toLowerCase();
      if (attrs.has(name)) return undefined;
      attrs.set(name, decode(attr[2] ?? attr[3] ?? attr[4] ?? ""));
      offset = attr.index + attr[0].length;
    }
    if (body.slice(offset).trim()) return undefined;
    const parent = stack.at(-1)!, node: Node = { tag, attrs, parent, children: [] };
    parent.children.push(node);
    if (["script", "style", "textarea", "title"].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "giu"); close.lastIndex = end;
      const closing = close.exec(html); if (!closing) return undefined;
      node.children.push(html.slice(end, closing.index));
      end = close.lastIndex; tokens.lastIndex = end;
    } else if (!voidTags.has(tag)) {
      if (/\/\s*>$/u.test(token)) return undefined;
      stack.push(node);
    }
  }
  if (stack.length !== 1 || html.slice(end).includes("<")) return undefined;
  root.children.push(html.slice(end)); return root;
}
const children = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");
function descendants(node: Node): Node[] { return children(node).flatMap(child => [child, ...descendants(child)]); }
const automation = (node: Node) => node.attrs.get("data-automation-id");
const elements = (node: Node, id: string) => descendants(node).filter(child => automation(child) === id);
function contains(parent: Node, child: Node): boolean { return child === parent || child.parent !== undefined && contains(parent, child.parent); }
function hidden(node: Node): boolean {
  return node.attrs.has("hidden") || node.attrs.has("inert") || node.attrs.get("aria-hidden")?.toLowerCase() === "true"
    || /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))/iu.test(node.attrs.get("style") ?? "")
    || /(?:^|\s)(?:hidden|invisible|sr-only)(?:\s|$)/u.test(node.attrs.get("class") ?? "")
    || ["template", "noscript"].includes(node.tag) || node.parent !== undefined && hidden(node.parent);
}
const excluded = new Set("aside nav footer header form button input select textarea script style template noscript iframe object svg dialog address article".split(" "));
function unrelated(node: Node): boolean {
  return excluded.has(node.tag) || /(?:similar|recommend|sidebar|widget|jobResults|jobDetails)/iu.test(automation(node) ?? "")
    || /(?:^|[\s_-])(?:card|widget|recommendation|sidebar)(?:$|[\s_-])/iu.test([node.attrs.get("class"), node.attrs.get("id")].join(" "));
}
function ownedPath(node: Node, owner: Node): boolean {
  return !hidden(node) && !unrelated(node) && (node === owner || node.parent !== undefined && ownedPath(node.parent, owner));
}
const proseTags = new Set("p div span b strong em i u br ul ol li a h2 h3 h4".split(" "));
/** Reconstruct prose, excluding hidden nodes and nested UI/automation regions. */
function prose(node: Node, root = true): string {
  if (hidden(node) || unrelated(node) || !root && automation(node) !== undefined) return "";
  if (!root && !proseTags.has(node.tag)) return "";
  const inner = node.children.map(child => typeof child === "string" ? escape(decode(child)) : prose(child, false)).filter(Boolean).join(" ");
  return root ? inner : `<${node.tag}>${inner}${voidTags.has(node.tag) ? "" : `</${node.tag}>`}`;
}
function plain(node: Node): string { return randstadText(prose(node)).replace(/\s+/gu, " ").trim(); }
function field(details: Node, id: string): string | undefined {
  const matches = elements(details, id);
  if (matches.length !== 1 || !ownedPath(matches[0]!, details)) return undefined;
  const values = descendants(matches[0]!).filter(node => node.tag === "dd");
  return values.length === 1 && ownedPath(values[0]!, details) ? plain(values[0]!) || undefined : undefined;
}
function facts(root: Node) {
  const pages = elements(root, "jobPostingPage"), allHeaders = elements(root, "jobPostingHeader"), regions = elements(root, "job-posting-details");
  // Workday may render a sticky duplicate of the direct page header after scrolling.
  // It is a corroborating UI clone, never an additional vacancy evidence source.
  const stickyRegions = elements(root, "jobPostingStickyWrapper");
  if (stickyRegions.length > 1) return undefined;
  const sticky = stickyRegions[0];
  const headers = allHeaders.filter(header => !sticky || !contains(sticky, header));
  if (pages.length !== 1 || headers.length !== 1 || regions.length !== 1
    || ["jobSearchPage", "jobResults", "jobDetails"].some(id => elements(root, id).length)) return undefined;
  const page = pages[0]!, header = headers[0]!, details = regions[0]!, owner = details.parent;
  if (!owner || owner === page || !contains(page, owner) || !contains(owner, header)
    || !ownedPath(header, page) || !ownedPath(details, page) || !/^h[12]$/u.test(header.tag)) return undefined;
  if (sticky) {
    const clones = elements(sticky, "jobPostingHeader");
    if (sticky.parent !== owner || children(owner)[0] !== sticky || !ownedPath(sticky, page)
      || clones.length !== 1 || !/^h[12]$/u.test(clones[0]!.tag) || hidden(clones[0]!)
      || plain(clones[0]!) !== plain(header) || elements(sticky, "adventureButton").length !== 1
      || descendants(sticky).some(node => automation(node) !== undefined
        && !["jobPostingHeader", "adventureButton"].includes(automation(node)!))) return undefined;
  }
  const branches = children(owner).filter(node => node !== sticky);
  if (branches.length !== 2 || branches[1] !== details || !contains(branches[0]!, header)) return undefined;
  const title = plain(header), requisitionId = field(details, "requisitionId"), locationText = field(details, "locations"), contractText = field(details, "time");
  const descriptions = elements(details, "jobPostingDescription");
  if (title.length < 5 || title.length > 250 || /^(?:search(?: jobs)?|jobs?|careers?|vacancies)$/iu.test(title)
    || !/^JR[1-9]\d*$/u.test(requisitionId ?? "") || !locationText || !contractText
    || descriptions.length !== 1 || !ownedPath(descriptions[0]!, details)) return undefined;
  const descriptionHtml = prose(descriptions[0]!), description = randstadText(descriptionHtml);
  if (!description) return undefined;
  const companies = elements(details, "company");
  const displayedCompanyName = companies.length ? field(details, "company") : undefined;
  if (companies.length && !displayedCompanyName) return undefined;
  return { title, requisitionId: requisitionId!, locationText, contractText, description, descriptionHtml,
    ...(displayedCompanyName === undefined ? {} : { displayedCompanyName }), owner, sticky };
}
export function airbusDirectFacts(html: string) {
  const root = parse(html), found = root && facts(root);
  if (!found) return undefined;
  const { owner: _owner, sticky: _sticky, descriptionHtml: _html, requisitionId: _id, ...projection } = found;
  return projection;
}
export class AirbusDirectVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]): AcquisitionContext | undefined {
    const route = airbusDirectRoute(input.sourceUrl);
    if (input.providerKey !== "AIRBUS_WORKDAY" || !route
      || input.externalId !== undefined && input.externalId !== route.requisitionId) return undefined;
    const root = parse(input.html), selected = root && facts(root);
    if (!root || !selected || selected.requisitionId !== route.requisitionId) return undefined;
    // Optional structured identity is a veto only. Never project page-level JSON-LD facts.
    const documents: unknown[] = [];
    for (const script of descendants(root).filter(node => node.tag === "script" && node.attrs.get("type")?.toLowerCase() === "application/ld+json")) {
      try { documents.push(JSON.parse(script.children.join(""))); } catch { return undefined; }
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(documents);
    if (postings.length > 1) return undefined;
    for (const posting of postings) {
      const identifier = posting.identifier !== null && typeof posting.identifier === "object"
        ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      if (posting.identifier !== undefined && identifier !== route.requisitionId) return undefined;
    }
    const actions = elements(selected.owner, "adventureButton").filter(node => !selected.sticky || !contains(selected.sticky, node));
    if (actions.length > 1 || selected.sticky && actions.length !== 1) return undefined;
    for (const node of descendants(selected.owner)) {
      const href = node.attrs.get("href");
      if (automation(node) === "adventureButton" && (!href || hidden(node))) return undefined;
      if (!href) continue;
      let url: URL; try { url = new URL(href, input.sourceUrl); } catch { return undefined; }
      if (automation(node) !== "adventureButton" && !/\/apply\/?$/u.test(url.pathname)) continue;
      url.pathname = url.pathname.replace(/\/apply\/?$/u, "");
      const apply = airbusDirectRoute(url.href);
      if (!apply || apply.requisitionId !== route.requisitionId) return undefined;
    }
    const value = (id: string, content: string) => `<div data-automation-id="${id}"><dl><dd>${escape(content)}</dd></dl></div>`;
    const html = `<div data-automation-id="jobPostingPage"><div><h2 data-automation-id="jobPostingHeader">${escape(selected.title)}</h2><div data-automation-id="job-posting-details">`
      + value("requisitionId", selected.requisitionId) + value("locations", selected.locationText) + value("time", selected.contractText)
      + (selected.displayedCompanyName === undefined ? "" : value("company", selected.displayedCompanyName))
      + `<div data-automation-id="jobPostingDescription">${selected.descriptionHtml}</div></div></div></div>`;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "AIRBUS_WORKDAY",
      providerExternalId: selected.requisitionId, html,
      text: [selected.title, selected.requisitionId, selected.locationText, selected.contractText, selected.displayedCompanyName, selected.description].filter(Boolean).join("\n"),
      metadata: { routeId: route.routeId, requisitionId: selected.requisitionId },
      associationEvidence: ["AIRBUS_DIRECT_JOB_ROUTE", "OWNED_DIRECT_JOB_DETAILS", "MATCHING_DOM_REQUISITION"] });
  }
}

/** Shared structural operations; selected-pane routing does not alter the direct contract. */
export const airbusDom = { parse, children, descendants, elements, contains, hidden, ownedPath, plain, escape, automation };
