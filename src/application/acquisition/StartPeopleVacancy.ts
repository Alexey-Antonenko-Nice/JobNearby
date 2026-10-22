import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function startPeopleVacancyId(value: string): string | undefined {
  try { const url = new URL(value); return /^(?:www\.)?startpeople\.fr$/u.test(url.hostname) && ["http:", "https:"].includes(url.protocol)
    ? /^\/offre-emploi\/[^/]+\/[^/]+\/([1-9]\d*)\/?$/u.exec(url.pathname)?.[1] : undefined; } catch { return undefined; }
}
export function startPeopleFacts(html: string) {
  const titles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  const values: Record<string, string> = {};
  for (const card of elements(html, "block-info-select-job")) {
    const labels = elements(card, "name-zone");
    const results = ["results-name-zone", "results-other", "results-city"].flatMap(key => elements(card, key));
    if (labels.length !== 1 || results.length !== 1) return undefined;
    const label = text(labels[0]!).replace("l'offre", "l’offre"); if (label in values) return undefined;
    values[label] = text(results[0]!);
  }
  const descriptions = elements(html, "description-offre");
  const description = descriptions.find(part => /<h2\b[^>]*>\s*Description du poste\s*<\/h2>/iu.test(part));
  const profile = descriptions.find(part => /<h2\b[^>]*>\s*Profil recherché\s*<\/h2>/iu.test(part));
  if (titles.length !== 1 || descriptions.length !== 2 || !description || !profile ||
    ["Localisation", "Contrat", "Votre agence", "N° de l’offre"].some(key => !values[key])) return undefined;
  return { title: text(titles[0]![1]!), values, description: text(description), profile: text(profile) };
}
export function startPeoplePublishedAt(html: string) {
  const raw = startPeopleFacts(html)?.values["Publiée le"];
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(raw ?? "");
  if (!match) return undefined;
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCDate() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) ? date : undefined;
}
export class StartPeopleSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = startPeopleVacancyId(input.sourceUrl);
    if (input.providerKey !== "START_PEOPLE" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const mains = [...clean.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/giu)];
    if (mains.length !== 1) return undefined;
    const main = mains[0]![0];
    const titles = [...main.matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/giu)];
    if (titles.length !== 1) return undefined;
    const cards = elements(main, "block-info-select-job");
    const descriptions = elements(main, "description-offre");
    const bounded = titles[0]![0] + cards.join("\n") + descriptions.join("\n");
    const facts = startPeopleFacts(bounded);
    if (!facts || facts.values["N° de l’offre"] !== id || /<(?:nav|footer|form|main)\b/iu.test(bounded)) return undefined;
    for (const match of main.matchAll(/\bdata-ref=["']([^"']+)["']|\bhref=["']\/postuler\/([^"']+)["']/giu)) if ((match[1] ?? match[2]) !== id) return undefined;
    for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
      if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/iu.test(tag[0])) continue;
      const value = /\b(?:href|content)=["']([^"']+)["']/iu.exec(tag[0])?.[1];
      const linked = value ? startPeopleVacancyId(value) : undefined;
      if (linked && linked !== id) return undefined;
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    const matched = postings.filter(posting => {
      const identifier = posting.identifier;
      const explicit = typeof identifier === "object" && identifier !== null ? (identifier as Record<string, unknown>).value : identifier;
      const linked = typeof posting.url === "string" ? startPeopleVacancyId(posting.url) : undefined;
      return (explicit === id || linked === id) && (explicit === undefined || String(explicit) === id) && (posting.url === undefined || linked === id);
    });
    // A posting claiming this URL with a different identifier is contradictory.
    for (const posting of postings) {
      const identifier = posting.identifier;
      const explicit = typeof identifier === "object" && identifier !== null ? (identifier as Record<string, unknown>).value : identifier;
      const linked = typeof posting.url === "string" ? startPeopleVacancyId(posting.url) : undefined;
      if ((linked === id || String(explicit) === id) && ((explicit !== undefined && String(explicit) !== id) || (linked !== undefined && linked !== id))) return undefined;
    }
    const employmentType = matched.length === 1 ? matched[0]!.employmentType : undefined;
    const terms = typeof employmentType === "string" ? [employmentType] : Array.isArray(employmentType) ? employmentType : [];
    const hours = terms.filter(term => term === "FULL_TIME" || term === "PART_TIME");
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "START_PEOPLE", providerExternalId: id,
      html: bounded, text: facts.title + "\n" + cards.filter(card => !/Votre agence/u.test(text(card))).map(text).join("\n") + "\n" + facts.description + "\n" + facts.profile,
      metadata: { structuredEmploymentTypes: hours, structuredIdentity: matched.length === 1 ? id : "" },
      associationEvidence: ["BOUNDED_JOB_DETAIL", "START_PEOPLE_DIRECT_JOB", "URL_EXTERNAL_ID", "VISIBLE_OFFER_NUMBER"] });
  }
}
