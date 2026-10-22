import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

function reference(value: unknown) { return typeof value === "string" && /^re\d+a\d+$/iu.test(value) ? value.toUpperCase() : undefined; }
export function actualVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?actualgroup\.com$/u.test(url.hostname) || !["http:", "https:"].includes(url.protocol)) return undefined;
    return reference(/^\/offres-emploi\/[^/]+-(re\d+a\d+)\/?$/iu.exec(url.pathname)?.[1]);
  } catch { return undefined; }
}
export function actualHeading(html: string) {
  return randstadText(html.replace(/<span\b[^>]*class=["'][^"']*\bsr-only\b[^"']*["'][^>]*>[\s\S]*?<\/span>/giu, ""));
}
function sections(html: string) { return [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/giu)].map(match => match[0]); }
export function actualSection(html: string, title: string) {
  const matches = sections(html).filter(section => {
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/iu.exec(section)?.[1];
    return h2 !== undefined && randstadText(h2) === title;
  });
  return matches.length === 1 ? matches[0] : undefined;
}
export function actualFacts(html: string) {
  const titles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  if (titles.length !== 1) return undefined;
  const cards = elements(html, "ring-muted/50");
  const titleCards = cards.filter(card => /<h1\b/iu.test(card));
  const agencyCards = cards.filter(card => /<(?:a|nuxtlink)\b[^>]*(?:href|to)=["']\/agences\/[^"']+["']/iu.test(card));
  if (titleCards.length !== 1 || agencyCards.length !== 1) return undefined;
  const badges = [...titleCards[0]!.matchAll(/<span\b[^>]*data-slot=["']label["'][^>]*>([\s\S]*?)<\/span>/giu)].map(match => randstadText(match[1]!));
  const locations = badges.filter(badge => /^[\p{L} '\u2019.-]+,\s*\d{5},\s*[\p{L} '\u2019.-]+$/u.test(badge));
  const contracts = badges.filter(badge => /^(?:CDI|CDD|int[eé]rim)$/iu.test(badge));
  const schedules = badges.filter(badge => /^temps (?:plein|partiel)$/iu.test(badge));
  const agency = [...agencyCards[0]!.matchAll(/<(a|nuxtlink)\b[^>]*(?:href|to)=["']\/agences\/[^"']+["'][^>]*>([\s\S]*?)<\/\1>/giu)];
  if (locations.length !== 1 || contracts.length !== 1 || schedules.length > 1 || agency.length !== 1) return undefined;
  const description = /<\/(?:a|nuxtlink)>\s*<p\b[^>]*>([\s\S]*?)<\/p>/iu.exec(agencyCards[0]!)?.[1];
  const job = actualSection(html, "Le poste");
  const profile = actualSection(html, "Le profil recherché");
  const company = actualSection(html, "L'entreprise");
  const title = actualHeading(titles[0]![1]!);
  const name = randstadText(agency[0]![2]!);
  if (!job || !profile || !company || !description || !title || !name) return undefined;
  return { title, location: locations[0]!, contract: contracts[0]!, schedule: schedules[0], name, agencyDescription: randstadText(description),
    titleCard: titleCards[0]!, agencyCard: agencyCards[0]!, job, profile, company,
    category: badges.filter(badge => !locations.includes(badge) && !contracts.includes(badge) && !schedules.includes(badge)) };
}
export class ActualSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = actualVacancyId(input.sourceUrl);
    if (input.providerKey !== "ACTUAL" || !id || (input.externalId !== undefined && reference(input.externalId) !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const mains = [...clean.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/giu)];
    if (mains.length !== 1) return undefined;
    const main = mains[0]![0];
    const headerSections = sections(main).filter(section => /<h1\b/iu.test(section));
    if (headerSections.length !== 1) return undefined;
    const jobSections = ["Le poste", "Le profil recherché", "L'entreprise"].map(title => actualSection(main, title));
    if (jobSections.some(section => section === undefined)) return undefined;
    const facts = actualFacts(headerSections[0]! + jobSections.join("\n"));
    if (!facts || !headerSections[0]!.includes(facts.titleCard) || !headerSections[0]!.includes(facts.agencyCard)) return undefined;
    const bounded = facts.titleCard + facts.agencyCard + facts.job + facts.profile + facts.company;
    if (/<(?:form|input|select|nav|footer|main)\b/iu.test(bounded)) return undefined;
    for (const match of bounded.matchAll(/\bdata-(?:offer-id|job-id|offer-reference)=["']([^"']+)["']/giu)) if (reference(match[1]) !== id) return undefined;
    for (const match of randstadText(bounded).matchAll(/\b(?:r[eé]f[eé]rence(?:\s+de\s+l['’]offre)?|reference)\s*:?\s*(RE\d+A\d+)\b/giu)) if (reference(match[1]) !== id) return undefined;
    for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
      if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/iu.test(tag[0])) continue;
      const url = /\b(?:href|content)=["']([^"']+)["']/iu.exec(tag[0])?.[1];
      const linkedId = url ? actualVacancyId(url) : undefined;
      if (linkedId && linkedId !== id) return undefined;
    }
    for (const match of bounded.matchAll(/\bhref=["']([^"']+)["']/giu)) {
      try { const linked = actualVacancyId(new URL(match[1]!, input.sourceUrl).href); if (linked && linked !== id) return undefined; } catch { /* Not a vacancy link. */ }
    }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    for (const posting of postings) {
      const raw = posting.identifier;
      const record = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : undefined;
      const explicit = reference(typeof raw === "string" ? raw : record?.value);
      const urlId = typeof posting.url === "string" ? actualVacancyId(posting.url) : undefined;
      if ((postings.length === 1 || explicit === id || urlId === id) && ((explicit !== undefined && explicit !== id) || (urlId !== undefined && urlId !== id))) return undefined;
    }
    // HTML retains agency contacts/company prose for audit. Generic extraction
    // sees job text only; neither agency addresses nor company headings are jobs.
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "ACTUAL", providerExternalId: id,
      html: bounded, text: actualHeading(facts.titleCard) + "\n" + randstadText(facts.job + facts.profile),
      associationEvidence: ["BOUNDED_JOB_DETAIL", "ACTUAL_DIRECT_JOB", "URL_EXTERNAL_ID", "EXPLICIT_AGENCY_CARD", "WORKPLACE_METADATA_BADGE"] });
  }
}
