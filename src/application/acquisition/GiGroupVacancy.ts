import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function giGroupVacancyId(value: string): string | undefined {
  try { const url = new URL(value); return url.hostname === "fr.gigroup.com" && ["https:", "http:"].includes(url.protocol)
    ? /^\/detail-offre-emploi\/[^/]+\/([1-9]\d*)\/?$/u.exec(url.pathname)?.[1] : undefined; } catch { return undefined; }
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function paragraphs(html: string) { return [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/giu)].map(match => match[0]); }
function marketing(paragraph: string) { return /^En tant que partenaire stratégique mondial, Gi Group\b/iu.test(text(paragraph)); }
export function giGroupFacts(html: string) {
  const groups = elements(html, "ggp-job-detail-div-group");
  const features = elements(html, "ggp-job-feature");
  if (groups.length !== 3 || features.length !== 1 || !groups[0]!.includes(features[0]!)) return undefined;
  const description = groups[1]!;
  const ps = paragraphs(description);
  const title = ps[0] ? text(ps[0]) : "";
  if (!ps[0] || !/<(?:b|strong)\b/iu.test(ps[0]) || !/\bH\s*\/\s*F\b/iu.test(title) || /[:\n]/u.test(title)) return undefined;
  if (!ps.some(p => text(p) === "Vos missions") || !ps.some(p => text(p) === "Votre profil")) return undefined;
  const values: Record<string, string> = {};
  for (const p of ps.slice(1)) {
    const match = /^(Type de contrat|Secteur géographique|Date de prise de poste|Base hebdomadaire|Rémunération|Avantages)\s*:\s*(.+)$/u.exec(text(p));
    if (!match) continue;
    if (match[1]! in values) return undefined;
    values[match[1]!] = match[2]!;
  }
  if (!values["Type de contrat"] || !values["Secteur géographique"]) return undefined;
  const badges = elements(features[0]!, "col-auto").map(text);
  const contracts = badges.filter(value => /^(?:CDI|CDD|Intérim)$/iu.test(value));
  const schedules = badges.filter(value => /^Temps (?:plein|partiel)$/iu.test(value));
  const dates = badges.filter(value => /^\d{4}-\d{2}-\d{2}$/u.test(value));
  if (contracts.length > 1 || schedules.length > 1 || dates.length > 1) return undefined;
  const geoRows = elements(groups[2]!, "col").filter(row => /class=["'][^"']*\bbi-geo-alt\b/iu.test(row));
  const geo = geoRows.length === 1 ? [...geoRows[0]!.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu)].map(match => text(match[1]!)) : [];
  const city = geo.at(-1), region = geo.at(-2);
  const workplace = values["Secteur géographique"]!;
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  if (city && normalize(workplace.replace(/\s*-\s*\d{2,3}\s*$/u, "")) !== normalize(city)) return undefined;
  return { title, values, description, location: city && region ? `${city}, ${region}` : workplace,
    contract: contracts[0], schedule: schedules[0], date: dates[0], jobText: text(ps.filter(marketing).reduce((value, p) => value.replace(p, ""), description)) };
}
export function giGroupPublishedAt(html: string) {
  const raw = giGroupFacts(html)?.date;
  if (!raw) return undefined;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? date : undefined;
}
export class GiGroupSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = giGroupVacancyId(input.sourceUrl);
    if (input.providerKey !== "GI_GROUP" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const wrappers = elements(clean, "ggp-job-detail-wrap");
    if (wrappers.length !== 1) return undefined;
    const details = elements(wrappers[0]!, "ggp-job-detail");
    if (details.length !== 1 || /<(?:aside|nav|footer|form|input)\b|class=["'][^"']*\bggp-job-detail-sidebar\b/iu.test(details[0]!)) return undefined;
    const facts = giGroupFacts(details[0]!);
    if (!facts) return undefined;
    const buttons = elements(wrappers[0]!, "ggp-job-detail-sidebar-buttons");
    if (buttons.length > 1) return undefined;
    for (const match of (buttons[0] ?? "").matchAll(/\bdata-job=(?:"([^"]*)"|'([^']*)')/giu)) {
      try { const state = record(JSON.parse(text(match[1] ?? match[2]!))); if (state?.offerNumber !== undefined && String(state.offerNumber) !== id) return undefined; } catch { return undefined; }
    }
    for (const match of (buttons[0] ?? "").matchAll(/\bhref=["']https:\/\/fr\.mygigroup\.com\/members\/jobs\/seek\/viewoffer\/(\d+)["']/giu)) if (match[1] !== id) return undefined;
    for (const match of details[0]!.matchAll(/\bdata-(?:offer-id|job-id|reference)=["']([^"']+)["']/giu)) if (match[1] !== id) return undefined;
    const prints = [...clean.matchAll(/<div\b[^>]*\bid=["']printable["'][^>]*>/giu)].map(match => {
      const tags = /<\/?div\b[^>]*>/giu; tags.lastIndex = match.index;
      let depth = 0;
      for (let tag = tags.exec(clean); tag; tag = tags.exec(clean)) {
        depth += tag[0].startsWith("</") ? -1 : 1;
        if (depth === 0) return clean.slice(match.index, tags.lastIndex);
      }
      return "";
    });
    if (prints.length > 1 || prints.some(print => !print)) return undefined;
    for (const item of elements(prints[0] ?? "", "p_hitem")) {
      const labels = elements(item, "p_hitem_title"), values = elements(item, "p_hitem_value");
      if (labels.length === 1 && text(labels[0]!) === "Code de référence:" && (values.length !== 1 || text(values[0]!) !== id)) return undefined;
    }
    for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
      if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/iu.test(tag[0])) continue;
      const url = /\b(?:href|content)=["']([^"']+)["']/iu.exec(tag[0])?.[1];
      const linked = url ? giGroupVacancyId(url) : undefined;
      if (linked && linked !== id) return undefined;
    }
    for (const node of elements(prints[0] ?? "", "p_url")) {
      const linked = giGroupVacancyId(text(node)); if (linked && linked !== id) return undefined;
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    const matched = [];
    for (const posting of postings) {
      const identifier = record(posting.identifier)?.value ?? posting.identifier;
      const explicit = typeof identifier === "string" || typeof identifier === "number" ? String(identifier) : undefined;
      const linked = typeof posting.url === "string" ? giGroupVacancyId(posting.url) : undefined;
      const current = explicit === id || linked === id;
      if ((current || postings.length === 1) && ((explicit !== undefined && explicit !== id) || (linked !== undefined && linked !== id))) return undefined;
      if (current && (explicit === undefined || explicit === id) && (posting.url === undefined || linked === id)) matched.push(posting);
    }
    const posting = matched.length === 1 ? matched[0] : undefined;
    const organization = record(posting?.hiringOrganization)?.name;
    const salary = record(posting?.baseSalary), amount = record(salary?.value);
    const unit = typeof amount?.unitText === "string" ? amount.unitText.toUpperCase() : undefined;
    const structuredPay = salary?.currency === "EUR" && typeof amount?.minValue === "number" && typeof amount?.maxValue === "number" && Number.isFinite(amount.minValue) && Number.isFinite(amount.maxValue) && amount.minValue >= 0 && amount.maxValue >= amount.minValue && ["HOUR", "MONTH", "YEAR"].includes(unit ?? "")
      ? { minimum: amount.minValue, maximum: amount.maxValue, period: unit! } : undefined;
    // The print duplicate, SEO title, category metadata and sidebar never become job text.
    let bounded = details[0]!;
    for (const p of paragraphs(bounded)) if (marketing(p)) bounded = bounded.replace(p, "");
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "GI_GROUP", providerExternalId: id,
      html: `<div class="ggp-job-detail-wrap">${bounded}</div>`, text: [facts.title, facts.schedule, facts.contract, facts.location, facts.date, facts.jobText].filter(Boolean).join("\n"),
      metadata: { ...(typeof organization === "string" && organization.trim() ? { organizationName: organization.trim() } : {}), ...(structuredPay ? { structuredPay } : {}) },
      associationEvidence: ["BOUNDED_JOB_DETAIL", "GI_GROUP_DIRECT_JOB", "URL_EXTERNAL_ID", "VACANCY_BODY_TITLE", ...(posting ? ["IDENTITY_MATCHED_JOB_POSTING"] : [])] });
  }
}
