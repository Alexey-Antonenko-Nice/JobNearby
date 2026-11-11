import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
import { alstomElements as elements } from "./AlstomVacancy.js";
import { reconcileExplicitIdentity } from "./reconcileExplicitIdentity.js";

export const HAYS_HOST = "m.hays.fr";
export function isHaysSource(sourceName: string, sourceUrl: string) {
  try { return sourceName === HAYS_HOST && new URL(sourceUrl).hostname === HAYS_HOST; } catch { return false; }
}
export function haysVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.hostname === HAYS_HOST && ["http:", "https:"].includes(url.protocol)
      ? /^\/careers\/Job\/Detail\/([1-9]\d*)\/?$/iu.exec(url.pathname)?.[1] : undefined;
  } catch { return undefined; }
}
function attr(open: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "iu").exec(open)?.[1];
}
function clean(html: string) {
  return html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
}
const byId = (html: string, id: string) => elements(html, open => attr(open, "id") === id);
const flat = (html: string) => randstadText(html).replace(/\s+/gu, " ").trim();
const hidden = (open: string) => /\s+hidden(?:\s|=|>)|\baria-hidden=["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(open);
const hasClass = (open: string, name: string) => attr(open, "class")?.split(/\s+/u).includes(name) === true;

// Vocabulary describing Hays's own business (recrutement, clients, talents) is
// deliberately absent: only vacancy-level intermediary wording qualifies.
const CLIENT_ASSIGNMENT = /\b(?:pour|chez)\s+notre\s+client\b|\bnotre\s+client\s+(?:recrute|recherche)\b|\b(?:recrutons|recrute)\s+pour\s+(?:notre|le)\s+client\b|\b(?:recruiting|hiring)\s+for\s+our\s+client\b|\bassignment\s+with\s+our\s+client\b/iu;
const FIRST_PERSON_HAYS = /\bBienvenue\s+chez\s+Hays\b|\bnos\s+\d[\d\s\u00a0\u202f.]*\s+experts\b/iu;

export function haysFacts(html: string) {
  const sections = elements(html, open => hasClass(open, "job-detail-cont"));
  if (sections.length !== 1) return undefined;
  const section = sections[0]!;
  const panes = elements(section, open => hasClass(open, "job-details"));
  const summaries = elements(section, open => hasClass(open, "job-summary") && hasClass(open, "job-box"))
    .filter(part => byId(part, "jd_reference").length === 1);
  if (panes.length !== 1 || summaries.length !== 1) return undefined;
  const titles = elements(panes[0]!, (_open, tag) => tag === "h3");
  const descriptions = elements(panes[0]!, open => hasClass(open, "job-description"));
  if (titles.length !== 1 || descriptions.length !== 1) return undefined;
  const field = (id: string) => {
    const found = byId(summaries[0]!, id);
    return found.length === 1 ? flat(found[0]!) : found.length === 0 ? "" : undefined;
  };
  const values = { type: field("jd_type"), flexible: field("jd_flexible"), location: field("jd_location"),
    specialism: field("jd_specialism"), salary: field("jd_salary"), reference: field("jd_reference") };
  if (Object.values(values).some(value => value === undefined)) return undefined;
  const parts = [titles[0]!, summaries[0]!, descriptions[0]!];
  if (parts.some(part => hidden(part.slice(0, part.indexOf(">") + 1)))) return undefined;
  if (parts.some(part => /<(?:nav|aside|footer|form|input|select)\b/iu.test(part))) return undefined;
  const title = flat(titles[0]!);
  const reference = values.reference!;
  const description = randstadText(descriptions[0]!);
  if (!title || title.length > 250 || !/^[1-9]\d*$/u.test(reference) || !description.trim()) return undefined;
  const analytics = ["JobId", "JobReference"].flatMap(id => byId(section, id).map(flat));
  if (reconcileExplicitIdentity(reference, analytics).status !== "MATCH") return undefined;
  const clientAssignment = CLIENT_ASSIGNMENT.test(description);
  return {
    title,
    reference,
    values: values as Readonly<Record<keyof typeof values, string>>,
    description,
    company: "Hays",
    clientAssignment,
    directEmployer: FIRST_PERSON_HAYS.test(description) && !clientAssignment,
    html: `<section class="job-detail-cont" data-hays-selected-vacancy-context="detail"><div class="job-details">${titles[0]!}\n${descriptions[0]!}</div>\n${summaries[0]!}</section>`
  };
}
export class HaysSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const routeId = haysVacancyId(input.sourceUrl);
    if (input.providerKey !== "HAYS" || !routeId
      || reconcileExplicitIdentity(routeId, input.externalId === undefined ? [] : [input.externalId]).status !== "MATCH") return undefined;
    const html = clean(input.html);
    const canonical = [...html.matchAll(/<link\b[^>]*>/giu)].filter(m => attr(m[0], "rel") === "canonical");
    if (canonical.length > 1 || reconcileExplicitIdentity(routeId, canonical.map(m => haysVacancyId(attr(m[0], "href") ?? "") ?? "")).status !== "MATCH") return undefined;
    const facts = haysFacts(html);
    if (!facts || reconcileExplicitIdentity(routeId, [facts.reference], { requireExplicitMatch: true }).status !== "MATCH") return undefined;
    return createAcquisitionContext({
      kind: "SELECTED_VACANCY",
      associationMethod: "PROVIDER_LOCATOR",
      providerKey: "HAYS",
      providerExternalId: routeId,
      html: facts.html,
      text: randstadText(facts.html),
      metadata: { detailId: routeId, reference: facts.reference },
      associationEvidence: ["VALIDATED_DETAIL_ROUTE", "MATCHING_VISIBLE_REFERENCE", "BOUNDED_JOB_DETAIL_AND_SUMMARY"]
    });
  }
}

/** Annual K€ ranges: "38 à 40 K€", "38-40 K€", "38 K€ à 40 K€". Variable pay and
 * benefits stay in the raw text and are never quantified. */
export function haysSalary(text: string) {
  if (/\b(?:mois|mensuel\w*|jour\w*|heure\w*|horaire\w*)\b/iu.test(text)) return undefined;
  const match = /(\d{1,3}(?:[.,]\d+)?)\s*(?:k\s*€)?\s*(?:à|a|-|–|—)\s*(\d{1,3}(?:[.,]\d+)?)\s*k\s*(?:€|euros?)/iu.exec(text);
  if (!match) return undefined;
  const minimum = Math.round(Number(match[1]!.replace(",", ".")) * 1000), maximum = Math.round(Number(match[2]!.replace(",", ".")) * 1000);
  return Number.isFinite(minimum) && Number.isFinite(maximum) && maximum >= minimum && minimum > 0
    ? { rawText: text, currency: "EUR", minimum, maximum, period: "YEAR" as const } : undefined;
}
