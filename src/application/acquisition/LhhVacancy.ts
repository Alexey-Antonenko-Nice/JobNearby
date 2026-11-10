import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
import { alstomElements as elements } from "./AlstomVacancy.js";

export const LHH_HOST = "lhh.com";

/** `/fr-fr/offres-emploi?jobId=<id>` (split layout) or the legacy `/fr-fr/offres-emploi/detail/<id>`. */
export function lhhVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?lhh\.com$/iu.test(url.hostname) || !["http:", "https:"].includes(url.protocol)) return undefined;
    const detail = /^\/fr-fr\/offres-emploi\/detail\/(\d+)\/?$/iu.exec(url.pathname)?.[1];
    if (detail) return detail;
    const ids = url.searchParams.getAll("jobId");
    return /^\/fr-fr\/offres-emploi\/?$/iu.test(url.pathname) && ids.length === 1 && /^[1-9]\d*$/u.test(ids[0]!) ? ids[0] : undefined;
  } catch { return undefined; }
}

function attr(open: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "iu").exec(open)?.[1];
}
const hasClass = (open: string, name: string) => attr(open, "class")?.split(/\s+/u).includes(name) === true;
const flat = (html: string) => randstadText(html).replace(/[\u00a0\u202f]/gu, " ").replace(/\s+/gu, " ").trim();
function clean(html: string) {
  return html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
}

// Only vacancy-level intermediary wording counts. LHH's own business description
// ("cabinet de conseil en recrutement, intérim spécialisé…") never does by itself.
const CLIENT_ASSIGNMENT = /\brecherche\s+pour\s+(?:son|notre)\s+client\b|\b(?:pour|chez)\s+notre\s+client\b|\bnotre\s+client\s+(?:recrute|recherche)\b|\brecrut\w*\s+pour\s+(?:son|notre|le)\s+client\b|\b(?:recruiting|hiring)\s+for\s+our\s+client\b|\bassignment\s+with\s+our\s+client\b/iu;

export function lhhFacts(html: string) {
  const panes = elements(html, open => hasClass(open, "job_Details"));
  if (panes.length !== 1) return undefined;
  const pane = panes[0]!;
  const boxes = elements(pane, open => hasClass(open, "scrollbar-box"));
  const descriptions = elements(pane, open => hasClass(open, "VacancyDescription"));
  const references = elements(pane, (open, tag) => tag === "b" && hasClass(open, "job-id"));
  if (boxes.length !== 1 || descriptions.length !== 1 || references.length !== 1) return undefined;
  const box = boxes[0]!;
  const one = (predicate: (open: string, tag: string) => boolean) => {
    const found = elements(box, predicate);
    return found.length === 1 ? flat(found[0]!) : found.length === 0 ? "" : undefined;
  };
  const title = one((open, tag) => tag === "div" && hasClass(open, "h3"));
  const category = one((open, tag) => tag === "div" && hasClass(open, "h4"));
  const salary = one((open, tag) => tag === "div" && hasClass(open, "text-salary"));
  const publication = /Publi[ée]\s+il\s+y\s+a\s+\d+\s+jours?(?:\(s\))?/iu.exec(flat(box))?.[0] ?? "";
  if ([title, category, salary].some(value => value === undefined)) return undefined;
  const rows = elements(box, open => hasClass(open, "job-icon"));
  const row = (icon: string) => {
    const found = rows.filter(part => new RegExp(`>\\s*${icon}\\s*<`, "iu").test(part));
    return found.length === 1 ? flat(found[0]!).replace(new RegExp(`^${icon}\\s*`, "iu"), "") : found.length === 0 ? "" : undefined;
  };
  const location = row("location_on"), contract = row("work_outline");
  const reference = flat(references[0]!);
  const description = randstadText(descriptions[0]!);
  if (location === undefined || contract === undefined || !title || title!.length > 250 || !/^[1-9]\d*$/u.test(reference) || !description.trim()) return undefined;
  const clientAssignment = CLIENT_ASSIGNMENT.test(flat(descriptions[0]!));
  return {
    title: title!,
    reference,
    location,
    contract,
    salary: salary!,
    category: category!,
    publication,
    description,
    company: "LHH Recruitment Solutions",
    clientAssignment,
    html: `<section class="job_Details" data-lhh-selected-vacancy-context="pane">${box}\n${descriptions[0]!}\n<p><span>Référence : </span>${references[0]!}</p></section>`,
  };
}

/** Pane links that carry an explicit vacancy id must all agree with the route id. */
function paneLinkIdsAgree(pane: string, routeId: string) {
  const ids = [...pane.matchAll(/offres-emploi(?:\/|%2F)[^"'\s<>]*?(?:\/|%2F)(\d{6,})(?=["'\s<>?#])/giu)].map(match => match[1]!);
  return ids.every(id => id === routeId);
}

export class LhhSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const routeId = lhhVacancyId(input.sourceUrl);
    if (input.providerKey !== "LHH" || !routeId || input.externalId !== undefined && input.externalId !== routeId) return undefined;
    const html = clean(input.html);
    if (/\bjob_Details\b/u.test(html)) {
      const facts = lhhFacts(html);
      if (!facts || facts.reference !== routeId) return undefined;
      const pane = elements(html, open => hasClass(open, "job_Details"))[0]!;
      if (!paneLinkIdsAgree(pane, routeId)) return undefined;
      return createAcquisitionContext({
        kind: "SELECTED_VACANCY",
        associationMethod: "PROVIDER_LOCATOR",
        providerKey: "LHH",
        providerExternalId: routeId,
        html: facts.html,
        text: flat(facts.html),
        metadata: { jobId: routeId, reference: facts.reference },
        associationEvidence: ["URL_EXTERNAL_ID", "MATCHING_VISIBLE_REFERENCE", "BOUNDED_SELECTED_JOB_PANE"],
      });
    }
    // Legacy single-vacancy detail route: only the bounded <main> of that page.
    if (!/^\/fr-fr\/offres-emploi\/detail\//iu.test(new URL(input.sourceUrl).pathname)) return undefined;
    const main = html.match(/<main\b[\s\S]*?<\/main>/iu)?.[0] ?? html;
    const text = flat(main);
    if (!/Responsable\s+maintenance|offres-emploi|recherche\s+pour\s+son\s+client/iu.test(text)) return undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "LHH", providerExternalId: routeId, associationEvidence: ["URL_EXTERNAL_ID", "LHH_DETAIL_PAGE"], text, html: main });
  }
}

/** "€ 40000 - € 45000 / Annuel", "40 000 € - 45 000 € / Annuel", "€ 40000 à € 45000 / Annuel". */
export function lhhSalary(text: string) {
  const amount = "(\\d{1,3}(?:[\\s.,]\\d{3})+|\\d+)";
  const match = new RegExp(`€?\\s*${amount}\\s*€?\\s*(?:-|–|—|à|a)\\s*€?\\s*${amount}\\s*€?\\s*\\/\\s*(?:annuel|an|year)\\b`, "iu").exec(text.replace(/[\u00a0\u202f]/gu, " "));
  if (!match) return undefined;
  const minimum = Number(match[1]!.replace(/[\s.,]/gu, "")), maximum = Number(match[2]!.replace(/[\s.,]/gu, ""));
  return Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > 0 && maximum >= minimum
    ? { rawText: text, currency: "EUR", minimum, maximum, period: "YEAR" as const } : undefined;
}
