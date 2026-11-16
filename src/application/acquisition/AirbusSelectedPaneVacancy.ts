import { createAcquisitionContext, type AcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { AIRBUS_WORKDAY_HOST, AirbusDirectVacancyContextLocator, airbusDirectFacts, airbusDirectRoute, airbusDom as dom } from "./AirbusWorkdayVacancy.js";

type Node = NonNullable<ReturnType<typeof dom.parse>>;
export function airbusDetailsRoute(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== AIRBUS_WORKDAY_HOST || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return undefined;
    const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?airbus\/details\/[^/]+_((JR[1-9]\d*)(-1)?)\/?$/iu.exec(url.pathname);
    return match ? { routeId: match[1]!.toUpperCase(), requisitionId: match[2]!.toUpperCase(), suffixed: !!match[3] } : undefined;
  } catch { return undefined; }
}
function common(left: Node, right: Node): Node | undefined {
  let node: Node | undefined = left;
  while (node && !dom.contains(node, right)) node = node.parent;
  return node;
}
function serialize(node: Node): string {
  const attrs = [...node.attrs].map(([key, value]) => ` ${key}="${dom.escape(value)}"`).join("");
  const inner = node.children.map(child => typeof child === "string" ? child : serialize(child)).join("");
  return `<${node.tag}${attrs}>${inner}${/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/u.test(node.tag) ? "" : `</${node.tag}>`}`;
}
export interface AirbusSelectedPaneOwnedFields {
  readonly company?: string;
  readonly employmentType?: string;
  readonly experienceLevel?: string;
  readonly jobFamily?: string;
}
const descriptionLabels = ["Company", "Employment Type", "Experience Level", "Job Family"] as const;
function plainText(value: string): string {
  return dom.plain({ tag: "span", attrs: new Map(), children: [value] });
}
function descriptionField(description: Node, label: typeof descriptionLabels[number]): string | undefined | null {
  const expression = new RegExp(`^${label}\\s*:\\s*(.*)$`, "iu");
  const matches = dom.descendants(description).filter(node => node.tag === "p" && dom.ownedPath(node, description)
    && expression.test(dom.plain(node).replace(/\s+/gu, " ").trim()));
  if (matches.length > 1) return null;
  const node = matches[0];
  if (!node) return undefined;
  let value = expression.exec(dom.plain(node).replace(/\s+/gu, " ").trim())?.[1]?.trim() ?? "";
  if (!value && node.parent) {
    const siblings = node.parent.children, index = siblings.indexOf(node);
    const textParts: string[] = [];
    for (const sibling of siblings.slice(index + 1)) {
      if (typeof sibling === "string") {
        const text = plainText(sibling).trim();
        if (text) textParts.push(text);
        continue;
      }
      if (!dom.ownedPath(sibling, description)) break;
      if (sibling.tag === "p") break;
      const text = dom.plain(sibling).replace(/\s+/gu, " ").trim();
      if (text) textParts.push(text);
    }
    if (textParts.length > 1) return null;
    if (textParts.length) value = textParts[0]!.trim();
  }
  if (!value || value.length > 250 || descriptionLabels.some(name => new RegExp(`^${name}\\s*:`, "iu").test(value))) return undefined;
  return value;
}
function descriptionFields(description: Node): AirbusSelectedPaneOwnedFields | undefined {
  const fields: Record<string, string> = {};
  for (const label of descriptionLabels) {
    const value = descriptionField(description, label);
    if (value === null) return undefined;
    if (value) fields[label === "Company" ? "company" : label === "Employment Type" ? "employmentType"
      : label === "Experience Level" ? "experienceLevel" : "jobFamily"] = value;
  }
  return fields;
}
export function airbusSelectedPaneOwnedFields(html: string): AirbusSelectedPaneOwnedFields | undefined {
  const root = dom.parse(html);
  if (!root || dom.elements(root, "jobPostingPage").length !== 1) return undefined;
  const descriptions = dom.elements(root, "jobPostingDescription");
  return descriptions.length === 1 ? descriptionFields(descriptions[0]!) : undefined;
}
const directUrl = (id: string) => `https://${AIRBUS_WORKDAY_HOST}/Airbus/job/selected/selected_${id}`;
function selectedContext(context: AcquisitionContext, route: NonNullable<ReturnType<typeof airbusDetailsRoute>>): AcquisitionContext {
  return createAcquisitionContext({ ...context, metadata: { routeId: route.routeId, requisitionId: route.requisitionId },
    associationEvidence: ["AIRBUS_DETAILS_ROUTE", "ARIA_CURRENT_RESULT_CARD", "OWNED_SELECTED_JOB_DETAILS", "MATCHING_DOM_REQUISITION"] });
}
/** Revalidate the reconstructed vacancy only; proof metadata must match exactly at the scope boundary. */
export function validateAirbusDetailsContext(context: AcquisitionContext, sourceUrl: string): AcquisitionContext | undefined {
  const route = airbusDetailsRoute(sourceUrl);
  if (!route || !context.html) return undefined;
  const checked = new AirbusDirectVacancyContextLocator().locate({ providerKey: "AIRBUS_WORKDAY", sourceUrl: directUrl(route.requisitionId), html: context.html, externalId: route.requisitionId });
  return checked ? selectedContext(checked, route) : undefined;
}
export class AirbusSelectedPaneContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]): AcquisitionContext | undefined {
    const route = airbusDetailsRoute(input.sourceUrl), root = dom.parse(input.html);
    if (!route || !root || input.providerKey !== "AIRBUS_WORKDAY" || input.externalId !== undefined && input.externalId !== route.requisitionId) return undefined;
    const searches = dom.elements(root, "jobSearchPage"), panes = dom.elements(root, "jobDetails"), results = dom.elements(root, "jobResults");
    if (searches.length !== 1 || panes.length !== 1 || results.length !== 1 || dom.elements(root, "jobPostingPage").length) return undefined;
    const search = searches[0]!, pane = panes[0]!, list = results[0]!;
    if (pane.tag !== "section" || list.tag !== "section" || !dom.contains(search, pane) || !dom.contains(search, list) || dom.hidden(pane) || dom.hidden(list)) return undefined;
    const selected = dom.elements(list, "jobTitle").filter(node => node.attrs.get("aria-current") === "true");
    if (selected.length !== 1) return undefined;
    const cardLink = selected[0]!;
    if (cardLink.tag !== "a" || dom.hidden(cardLink)) return undefined;
    let card: Node | undefined = cardLink.parent;
    while (card && card.tag !== "li" && card !== list) card = card.parent;
    if (!card || card.tag !== "li" || card.parent?.tag !== "ul" || card.parent.parent !== list || dom.elements(card, "jobTitle").length !== 1) return undefined;
    let cardRoute: ReturnType<typeof airbusDirectRoute>;
    try { cardRoute = airbusDirectRoute(new URL(cardLink.attrs.get("href") ?? "", input.sourceUrl).href); } catch { return undefined; }
    if (!cardRoute || cardRoute.requisitionId !== route.requisitionId) return undefined;
    const cardText = [dom.plain(card), ...dom.elements(card, "subtitle").map(node => dom.plain(node))].join(" ");
    const cardIds = cardText.match(/\bJR[1-9]\d*(?:-1)?\b/gu) ?? [];
    if (cardIds.some(id => id.replace(/-1$/u, "") !== route.requisitionId)) return undefined;
    const wrappers = dom.children(pane);
    if (wrappers.length !== 1) return undefined;
    const branches = dom.children(wrappers[0]!);
    if (branches.length !== 2) return undefined;
    const headers = dom.elements(branches[0]!, "jobPostingHeader"), descriptions = dom.elements(branches[1]!, "jobPostingDescription");
    // No selected-pane sticky state has been observed. Never invent ownership for one.
    if (dom.elements(pane, "jobPostingStickyWrapper").length || headers.length !== 1 || descriptions.length !== 1
      || dom.elements(pane, "jobPostingHeader").length !== 1) return undefined;
    const description = descriptions[0]!, header = headers[0]!;
    const requisitions = dom.elements(branches[1]!, "requisitionId").filter(node => {
      let current: Node | undefined = node;
      while (current && current !== branches[1]) {
        if (current.tag === "section" || dom.automation(current) === "sidebar") return false;
        current = current.parent;
      }
      return true;
    });
    if (requisitions.length !== 1) return undefined;
    const core = common(requisitions[0]!, description);
    if (!core || !dom.ownedPath(core, branches[1]!) || !dom.ownedPath(header, branches[0]!)) return undefined;
    const regions = dom.children(core);
    if (regions.length < 2 || !dom.contains(regions[0]!, requisitions[0]!) || !dom.contains(regions[1]!, description)) return undefined;
    const ownedFields = descriptionFields(description);
    if (!ownedFields) return undefined;
    // Only the field block and description block are vacancy-owned. These observed siblings are excluded wholesale.
    const excluded = regions.slice(2);
    if (excluded.some(node => !(node.tag === "section" && dom.elements(node, "similar-jobs-heading").length === 1)
      && dom.automation(node) !== "sidebar")
      || excluded.filter(node => node.tag === "section").length > 1 || excluded.filter(node => dom.automation(node) === "sidebar").length > 1) return undefined;
    if (dom.elements(regions[0]!, "jobPostingDescription").length || dom.elements(regions[1]!, "requisitionId").length) return undefined;
    const actions = dom.elements(branches[0]!, "adventureButton");
    if (actions.length !== 1) return undefined;
    let applyRoute: ReturnType<typeof airbusDetailsRoute>;
    try {
      const apply = new URL(actions[0]!.attrs.get("href") ?? "", input.sourceUrl);
      if (!/\/apply\/?$/u.test(apply.pathname) || dom.hidden(actions[0]!)) return undefined;
      apply.pathname = apply.pathname.replace(/\/apply\/?$/u, "");
      applyRoute = airbusDetailsRoute(apply.href) ?? airbusDirectRoute(apply.href);
    } catch { return undefined; }
    if (!applyRoute || applyRoute.requisitionId !== route.requisitionId) return undefined;
    // The selected apply identity was checked above; reconstruct its equivalent direct proof for the shared vacancy validator.
    actions[0]!.attrs.set("href", directUrl(route.requisitionId) + "/apply");
    const heading = common(header, actions[0]!);
    if (!heading || !dom.contains(branches[0]!, heading)) return undefined;
    const makeHtml = (companyName?: string) => `<div data-automation-id="jobPostingPage"><div>${serialize(heading)}<div data-automation-id="job-posting-details">${serialize(regions[0]!)}`
      + (companyName === undefined ? "" : `<div data-automation-id="company"><dl><dd>${dom.escape(companyName)}</dd></dl></div>`)
      + `${serialize(regions[1]!)}</div></div></div>`;
    const locator = new AirbusDirectVacancyContextLocator();
    const inputFor = (html: string) => ({ providerKey: "AIRBUS_WORKDAY" as const, sourceUrl: directUrl(route.requisitionId), html, externalId: route.requisitionId });
    let context = locator.locate(inputFor(makeHtml()));
    if (!context) return undefined;
    const existingCompany = airbusDirectFacts(context.html!)?.displayedCompanyName;
    if (ownedFields.company) {
      if (existingCompany && existingCompany.replace(/\s+/gu, " ").trim().toLowerCase() !== ownedFields.company.replace(/\s+/gu, " ").trim().toLowerCase()) return undefined;
      if (!existingCompany) context = locator.locate(inputFor(makeHtml(ownedFields.company)));
    }
    return context ? selectedContext(context, route) : undefined;
  }
}
