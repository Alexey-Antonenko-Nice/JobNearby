import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { alstomElements } from "./AlstomVacancy.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function michaelPageVacancyId(value: string, base?: string, apply = false): string | undefined {
  try { const url = new URL(value, base);
    if (!/^(?:www\.)?michaelpage\.fr$/u.test(url.hostname) || !["https:", "http:"].includes(url.protocol)) return undefined;
    const match = /^\/(job-detail|job-apply)\/[^/]+\/ref\/(jn-\d{6}-\d+)\/?$/iu.exec(url.pathname);
    return match && (match[1] === "job-detail" || apply) ? match[2]!.toLowerCase() : undefined;
  } catch { return undefined; }
}
function one(values: string[]) { return values.length === 1 ? values[0] : undefined; }
function byId(html: string, id: string) { return alstomElements(html, open => new RegExp(`\\bid=["']${id}["']`, "u").test(open)); }
function field(html: string, name: string) { const found = one(elements(html, name)); return found ? text(found).replace(/\s+/gu, " ") : undefined; }
function about(html: string) { return /\babout=["']([^"']+)["']/u.exec(html.slice(0, html.indexOf(">") + 1))?.[1]; }

export function michaelPagePublishedAt(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^Ajoutée le (\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? date : undefined;
}

export function michaelPageFacts(html: string) {
  const header = one(elements(html, "job-apply-block-container")), article = one(elements(html, "job-advert"));
  if (!header || !article || !/^<article\b/iu.test(article)) return undefined;
  const descriptionHtml = one(byId(article, "job-description")), summary = one(byId(article, "summary"));
  const title = field(header, "job-apply-job-title"), location = field(header, "job-location"), contract = field(header, "job-contract-type"), telework = field(header, "job-nature");
  if (!descriptionHtml || !summary || !title || !location || !contract) return undefined;
  const values: Record<string, string> = {};
  for (const dl of summary.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/giu)) {
    const labels = [...dl[1]!.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>/giu)], results = [...dl[1]!.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/giu)];
    if (labels.length !== 1 || results.length !== 1) return undefined;
    const label = text(labels[0]![1]!); if (label in values) return undefined;
    values[label] = text(results[0]![1]!);
  }
  const reference = values["Référence de l´offre"]?.toLowerCase();
  const contact = one(elements(descriptionHtml, "job-contact-info"));
  const refs = contact ? [...text(contact).matchAll(/\bJN-\d{6}-\d+\b/giu)].map(m => m[0].toLowerCase()) : [];
  if (!reference || !/^jn-\d{6}-\d+$/u.test(reference) || refs.length !== 1 || refs[0] !== reference
    || values["Où ?"] !== location || values["Type de contrat"] !== contract || (telework !== undefined && values["Poste à pourvoir en :"] !== telework)) return undefined;
  // All three body sections must survive; a header/summary alone is not a vacancy.
  if (["job_advert__job-desc-company", "job_advert__job-desc-role", "job_advert__job-desc-candidate", "job_advert__job-desc-deal"].some(name => !field(descriptionHtml, name))) return undefined;
  const publishedText = field(descriptionHtml, "job-posted-date");
  if (!michaelPagePublishedAt(publishedText)) return undefined;
  return { header, article, descriptionHtml, summary, title, location, contract, telework, reference, publishedText: publishedText!,
    description: text(descriptionHtml), clientText: field(descriptionHtml, "job_advert__job-desc-company")!, consultant: values["Nom du consultant"] };
}

export class MichaelPageSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = michaelPageVacancyId(input.sourceUrl);
    if (input.providerKey !== "MICHAEL_PAGE" || !id || (input.externalId !== undefined && input.externalId.toLowerCase() !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const facts = michaelPageFacts(clean);
    if (!facts || facts.reference !== id) return undefined;
    for (const part of [facts.header, facts.article]) {
      const opening = part.slice(0, part.indexOf(">") + 1);
      if (/\s(?:hidden(?:[\s=>])|aria-hidden=["']true["'])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(opening)
        || michaelPageVacancyId(about(part) ?? "", input.sourceUrl) !== id) return undefined;
    }
    const actions = elements(facts.article, "apply-job");
    if (actions.length !== 1 || text(actions[0]!) !== "Postuler") return undefined;
    const apply = /\bhref=["']([^"']+)["']/u.exec(actions[0]!)?.[1];
    if (!apply || michaelPageVacancyId(apply, input.sourceUrl, true) !== id) return undefined;
    for (const match of (facts.header + facts.article).matchAll(/\b(?:href|about)=["']([^"']+)["']/gu)) {
      if (/\/(?:job-detail|job-apply)\//u.test(match[1]!) && michaelPageVacancyId(match[1]!, input.sourceUrl, true) !== id) return undefined;
    }
    for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
      if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/u.test(tag[0])) continue;
      const url = /\b(?:href|content)=["']([^"']+)["']/u.exec(tag[0])?.[1];
      if (!url || michaelPageVacancyId(url, input.sourceUrl) !== id) return undefined;
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    for (const posting of postings) {
      const identifier = typeof posting.identifier === "object" && posting.identifier !== null ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      const ref = typeof identifier === "string" ? identifier.toLowerCase() : undefined;
      const linked = typeof posting.url === "string" ? michaelPageVacancyId(posting.url, input.sourceUrl) : undefined;
      if ((ref === id || linked === id || postings.length === 1) && ((identifier !== undefined && ref !== id) || (posting.url !== undefined && linked !== id))) return undefined;
    }
    const brand = /\balt=["']Michael Page - Cabinet de recrutement en France["']/u.test(clean)
      || /\bproperty=["']og:site_name["'][^>]*\bcontent=["']Michael Page France["']/u.test(clean);
    const intermediary = brand && /\b(?:mon|notre) client\b/iu.test(facts.clientText) && Boolean(facts.consultant);
    // Exclude navigation, the related-jobs aside and all generic JSON-LD
    // projections (publisher-as-employer and TELECOMMUTE are misleading here).
    const selected = `${facts.header}<article class="job-advert" about="${about(facts.article)}">${facts.descriptionHtml}${facts.summary}${actions[0]}</article>`;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "MICHAEL_PAGE", providerExternalId: id,
      html: selected, text: [facts.title, facts.location, facts.contract, facts.telework, facts.description].filter(Boolean).join("\n"),
      metadata: { publicationText: facts.publishedText, teleworkText: facts.telework, intermediaryName: intermediary ? "Michael Page" : undefined },
      associationEvidence: ["BOUNDED_JOB_ADVERT", "HEADER_AND_ARTICLE_URL", "DISPLAYED_REFERENCE", "SELECTED_APPLY_ACTION"] });
  }
}
