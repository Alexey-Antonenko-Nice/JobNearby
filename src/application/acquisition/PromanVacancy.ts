import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";

export function promanVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value), ids = url.searchParams.getAll("offre_id");
    return url.hostname === "mon-espace.proman-emploi.fr" && ["https:", "http:"].includes(url.protocol) && /^\/dashboard\/?$/u.test(url.pathname)
      && ids.length === 1 && /^[1-9]\d*$/u.test(ids[0]!) ? ids[0] : undefined;
  } catch { return undefined; }
}
function balanced(html: string, name: string, start: number) {
  const tags = new RegExp(`<\\/?${name}\\b[^>]*>`, "giu"); tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return undefined;
}
function hidden(tag: string) { return /\s(?:hidden(?:[\s=>])|aria-hidden=["']true["'])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(tag); }
// A stale rendered dialog inside a closed container is not an active vacancy.
function hiddenAncestor(html: string, index: number) {
  const stack: boolean[] = [];
  for (const match of html.slice(0, index).matchAll(/<\/?div\b[^>]*>/giu)) {
    if (match[0].startsWith("</")) stack.pop();
    else stack.push(hidden(match[0]) || stack.at(-1) === true);
  }
  return stack.at(-1) === true;
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
<div class="tab-content" x-show="activeTab === 'poste'"><p>${escape(facts.job)}</p></div>
<div class="tab-content" x-show="activeTab === 'profil'"><p>${escape(facts.profile)}</p></div></div></div>`;
}
export class PromanSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = promanVacancyId(input.sourceUrl);
    if (input.providerKey !== "PROMAN" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript|form|button|textarea|select|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const dialogs = [...clean.matchAll(/<([a-z][\w-]*)\b[^>]*\brole=["']dialog["'][^>]*>/giu)]
      .filter(match => !hidden(match[0]) && !hiddenAncestor(clean, match.index) && /\baria-modal=["']true["']/iu.test(match[0]))
      .map(match => balanced(clean, match[1]!, match.index)).filter((value): value is string => value !== undefined)
      .filter(dialog => elements(dialog, "panel-container").length > 0);
    if (dialogs.length !== 1) return undefined;
    const panels = elements(dialogs[0]!, "panel-container");
    if (panels.length !== 1 || hidden(panels[0]!.slice(0, panels[0]!.indexOf(">") + 1))) return undefined;
    const panel = panels[0]!;
    const ids = [...panel.matchAll(/\bdata-offre-id=["']([^"']+)["']|\bwire:click=["']toggleJobFavorite\(\d+,\s*(\d+),/giu)].map(match => match[1] ?? match[2]);
    for (const match of panel.matchAll(/\bhref=["']https:\/\/www\.proman-emploi\.fr\/mp(\d+)-[^"']+["']/giu)) ids.push(match[1]);
    if (!ids.length || ids.some(value => value !== id)) return undefined;
    const facts = promanFacts(panel);
    if (!facts) return undefined;
    const html = vacancyHtml(facts, id);
    // Agency names and contacts do not feed generic location/employer extraction.
    const vacancyText = [facts.title, facts.location, facts.contract, facts.salary, ...Object.entries(facts.values).flat(), facts.experience, facts.date, `REF ${facts.reference}`, facts.job, facts.profile].filter(Boolean).join("\n");
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "PROMAN", providerExternalId: id,
      html, text: vacancyText, associationEvidence: ["BOUNDED_JOB_DETAIL", "PROMAN_AUTHENTICATED_MODAL", "URL_EXTERNAL_ID", "PANEL_OFFER_ID", "EXPLICIT_BRANCH_LABEL"] });
  }
}
