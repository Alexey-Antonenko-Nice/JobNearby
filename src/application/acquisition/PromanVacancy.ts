import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { parsePromanHtml, descendants, hasClass, hiddenPromanNode, unrelatedPromanNode, promanOwnedProse, promanOwnedFields, type PromanNode } from "./PromanModalPrivacy.js";

export function promanVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value), ids = url.searchParams.getAll("offre_id");
    return url.hostname === "mon-espace.proman-emploi.fr" && ["https:", "http:"].includes(url.protocol) && /^\/dashboard\/?$/u.test(url.pathname)
      && ids.length === 1 && /^[1-9]\d*$/u.test(ids[0]!) ? ids[0] : undefined;
  } catch { return undefined; }
}
function parts(html: string, tag: string) { return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "giu"))].map(match => match[1]!); }
function tab(html: string, name: string) {
  const matches = elements(html, "tab-content").filter(part => new RegExp(`x-show=["']activeTab === ['"]${name}['"]["']`, "u").test(part));
  return matches.length === 1 ? matches[0] : undefined;
}
export function promanFacts(html: string) {
  const headers = elements(html, "popin-header-nuage");
  if (headers.length !== 1) return undefined;
  const header = headers[0]!, titles = parts(header, "h2"), paragraphs = parts(header, "p");
  const summary = tab(html, "resume"), job = tab(html, "poste"), profile = tab(html, "profil");
  if (titles.length !== 1 || !paragraphs[0] || !summary || !job || !profile) return undefined;
  const title = text(titles[0]!), location = text(paragraphs[0]);
  if (!title || !/^[\p{L} '\u2019.-]+\s*\(\d{2,3}\)$/u.test(location)) return undefined;
  const badges = elements(header, "tag-border-light").map(text);
  const contracts = badges.filter(value => /^(?:Intérim|CDI|CDD)$/iu.test(value));
  const salaries = badges.filter(value => /€/u.test(value));
  if (contracts.length !== 1 || salaries.length > 1) return undefined;
  const values: Record<string, string> = {};
  for (const paragraph of elements(summary, "text-label-small")) {
    const spans = parts(paragraph, "span").map(text);
    if (!["Durée", "Rythme de travail"].includes(spans[0] ?? "")) continue;
    if (spans.length !== 2 || spans[0]! in values) return undefined;
    values[spans[0]!] = spans[1]!;
  }
  const experiences = [...summary.matchAll(/<p\b[^>]*>\s*Expériences requises\s*<\/p>\s*<p\b[^>]*>([\s\S]*?)<\/p>/giu)];
  if (experiences.length > 1) return undefined;
  const agencies = elements(summary, "card").filter(card => /Mission proposée par/u.test(text(card)));
  if (agencies.length !== 1) return undefined;
  const labels = elements(agencies[0]!, "tag");
  if (labels.length !== 1) return undefined;
  const rawName = text(labels[0]!);
  const branded = /<img\b[^>]*\balt=["']Logo PROMAN["']/iu.test(labels[0]!);
  const agency = /^PROMAN\b/u.test(rawName) ? rawName : branded && rawName ? `PROMAN ${rawName}` : undefined;
  if (!agency) return undefined;
  const refs = parts(summary, "span").map(text).flatMap(value => /^REF\s+([A-Z0-9]+-[A-Z0-9]+)$/u.exec(value)?.[1] ?? []);
  const dates = parts(summary, "span").map(text).flatMap(value => /^Publiée le (\d{2}\/\d{2}\/\d{2}(?:\d{2})?)$/u.exec(value)?.[1] ?? []);
  if (new Set(refs).size !== 1 || new Set(dates).size > 1) return undefined;
  return { title, location, contract: contracts[0]!, salary: salaries[0], values, experience: experiences[0] ? text(experiences[0][1]!) : undefined,
    agency, reference: refs[0]!, date: dates[0], job: text(job), profile: text(profile) };
}
export function promanPublishedAt(html: string) {
  const raw = promanFacts(html)?.date;
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/u.exec(raw ?? "");
  if (!match) return undefined;
  const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(`${year}-${match[2]}-${match[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCDate() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) ? date : undefined;
}
const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
/** Persist vacancy facts only, never dashboard HTML, account state or active attributes. */
function vacancyHtml(facts: NonNullable<ReturnType<typeof promanFacts>>, id: string) {
  const value = (label: string, content: string) => `<p class="text-label-small"><span>${escape(label)}</span><br><span>${escape(content)}</span></p>`;
  return `<div role="dialog" aria-modal="true"><div class="panel-container" data-offre-id="${id}">
<div class="popin-header-nuage"><h2>${escape(facts.title)}</h2><p>${escape(facts.location)}</p><p><span class="tag-border-light">${escape(facts.contract)}</span>${facts.salary ? `<span class="tag-border-light">${escape(facts.salary)}</span>` : ""}</p></div>
<div class="tab-content" x-show="activeTab === 'resume'">${Object.entries(facts.values).map(([label, content]) => value(label, content)).join("")}
${facts.experience ? `<p>Expériences requises</p><p>${escape(facts.experience)}</p>` : ""}
<div class="card"><p>Mission proposée par</p><p class="tag">${escape(facts.agency)}</p></div>
${facts.date ? `<span>Publiée le ${escape(facts.date)}</span>` : ""}<span>REF ${escape(facts.reference)}</span></div>
<div class="tab-content" x-show="activeTab === 'poste'"><div class="text-body-small"><p>${escape(facts.job)}</p></div></div>
<div class="tab-content" x-show="activeTab === 'profil'"><div class="text-body-small"><p>${escape(facts.profile)}</p></div></div></div></div>`;
}
export class PromanSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = promanVacancyId(input.sourceUrl);
    if (input.providerKey !== "PROMAN" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const document = parsePromanHtml(input.html);
    if (!document) return undefined;
    const dialogs = descendants(document).filter(node => node.attrs.get("role") === "dialog"
      && node.attrs.get("aria-modal") === "true" && !hiddenPromanNode(node)
      && descendants(node).some(child => hasClass(child, "panel-container")));
    if (dialogs.length !== 1) return undefined;
    const panels = descendants(dialogs[0]!).filter(node => hasClass(node, "panel-container"));
    if (panels.length !== 1 || panels[0]!.parent !== dialogs[0] || hiddenPromanNode(panels[0]!)) return undefined;
    const panel = panels[0]!;
    const nodes = [panel, ...descendants(panel)];
    // Conflicting identities still reject the whole capture, even inside excluded widgets.
    const identifiers = nodes.flatMap(node => {
      const ids: string[] = [];
      if (node.attrs.has("data-offre-id")) ids.push(node.attrs.get("data-offre-id")!);
      const favorite = /^toggleJobFavorite\(\d+,\s*(\d+),/u.exec(node.attrs.get("wire:click") ?? "");
      if (favorite) ids.push(favorite[1]!);
      const link = /^https:\/\/www\.proman-emploi\.fr\/mp(\d+)-/u.exec(node.attrs.get("href") ?? "");
      if (link) ids.push(link[1]!);
      return ids.map(value => ({ value, node }));
    });
    if (!identifiers.length || identifiers.some(item => item.value !== id)
      || !identifiers.some(item => !hiddenPromanNode(item.node) && identityOwned(item.node, panel))) return undefined;
    const headers = nodes.filter(node => hasClass(node, "popin-header-nuage"));
    const tabs = nodes.filter(node => hasClass(node, "tab-content"));
    if (headers.length !== 1 || !regionOwned(headers[0]!, panel) || hiddenPromanNode(headers[0]!)) return undefined;
    const selectedTabs = ["resume", "poste", "profil"].map(name => tabs.filter(node => node.attrs.get("x-show") === `activeTab === '${name}'`));
    if (selectedTabs.some(matches => matches.length !== 1 || hiddenPromanNode(matches[0]!) || !regionOwned(matches[0]!, panel))) return undefined;
    const [summary, job, profile] = selectedTabs.map(matches => matches[0]!);
    const jobHtml = promanOwnedProse(job!), profileHtml = promanOwnedProse(profile!);
    if (jobHtml === undefined || profileHtml === undefined || !text(jobHtml) || !text(profileHtml)) return undefined;
    const owned = promanOwnedFields(headers[0]!)
      + `<div class="tab-content" x-show="activeTab === 'resume'">${promanOwnedFields(summary!)}</div>`
      + `<div class="tab-content" x-show="activeTab === 'poste'">${jobHtml}</div>`
      + `<div class="tab-content" x-show="activeTab === 'profil'">${profileHtml}</div>`;
    const facts = promanFacts(owned);
    if (!facts) return undefined;
    const html = vacancyHtml(facts, id);
    // Agency names and contacts do not feed generic location/employer extraction.
    const vacancyText = [facts.title, facts.location, facts.contract, facts.salary, ...Object.entries(facts.values).flat(), facts.experience, facts.date, `REF ${facts.reference}`, facts.job, facts.profile].filter(Boolean).join("\n");
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "PROMAN", providerExternalId: id,
      html, text: vacancyText, associationEvidence: ["BOUNDED_JOB_DETAIL", "PROMAN_AUTHENTICATED_MODAL", "URL_EXTERNAL_ID", "PANEL_OFFER_ID", "EXPLICIT_BRANCH_LABEL"] });
  }
}

/** Regions may only sit under neutral layout divs within this panel. */
function regionOwned(node: PromanNode, panel: PromanNode): boolean {
  if (node.tag !== "div" || [...node.attrs.keys()].some(key => !["class", "style", "x-show"].includes(key))) return false;
  for (let parent = node.parent; parent && parent !== panel; parent = parent.parent) {
    if (parent.tag !== "div" || unrelatedPromanNode(parent)) return false;
  }
  return true;
}
function identityOwned(node: PromanNode, panel: PromanNode): boolean {
  if (node === panel) return true;
  for (let parent = node.parent; parent && parent !== panel; parent = parent.parent) {
    if (parent.tag !== "div" || unrelatedPromanNode(parent) || hasClass(parent, "tab-content")) return false;
  }
  return true;
}
