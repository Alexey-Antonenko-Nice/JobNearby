import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function synergieVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    if (!/^(?:www\.)?synergie\.fr$/u.test(url.hostname) || !["https:", "http:"].includes(url.protocol)) return undefined;
    return /^\/trouver-un-emploi\/[^/]+\/offre-(\d+-\d+)\/?$/u.exec(url.pathname)?.[1];
  } catch { return undefined; }
}
function text(html: string) {
  return randstadText(html.replace(/<svg\b[\s\S]*?<\/svg>/giu, "").replace(/<span\b[^>]*style=["'][^"']*position:absolute[^"']*["'][^>]*>[\s\S]*?<\/span>/giu, ""));
}
function reference(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = /^(?:OFFRE\s*-\s*)?(\d+)[\s-]+(\d+)$/iu.exec(value.trim());
  return match ? `${match[1]}-${match[2]}` : undefined;
}
export function synergieCardFacts(card: string) {
  const values: Record<string, string> = {};
  for (const row of card.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)) {
    const paragraphs = [...row[1]!.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map(m => text(m[1]!));
    if (paragraphs.length !== 2 || values[paragraphs[0]!] !== undefined) return undefined;
    values[paragraphs[0]!] = paragraphs[1]!;
  }
  const refs = [...text(card).matchAll(/(?:Copier la )?r[eé]f[eé]rence de l['’]offre\s+((?:OFFRE\s*-\s*)?\d+[\s-]+\d+)/giu)];
  if (refs.length !== 1 || !values["Lieu de la mission"] || !values["Type de contrat"]) return undefined;
  return { reference: reference(refs[0]![1]), values };
}
export function synergieFacts(html: string) {
  const titles = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  const cards = elements(html, "shadow-bloc").filter(card => /<h3\b[^>]*>\s*D[eé]tails de l['’]offre\s*<\/h3>/iu.test(card));
  if (titles.length !== 1 || cards.length !== 1) return undefined;
  const facts = synergieCardFacts(cards[0]!);
  const title = text(titles[0]![1]!);
  return facts && title ? { title, ...facts } : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

export class SynergieSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = synergieVacancyId(input.sourceUrl);
    if (input.providerKey !== "SYNERGIE" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const articles = [...clean.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/giu)];
    if (articles.length !== 1) return undefined;
    const article = articles[0]![0];
    const titles = [...article.matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/giu)];
    const cards = elements(article, "shadow-bloc").filter(card => /<h3\b[^>]*>\s*D[eé]tails de l['’]offre\s*<\/h3>/iu.test(card));
    if (titles.length !== 1 || cards.length < 1 || cards.length > 2) return undefined;
    const facts = cards.map(synergieCardFacts);
    if (facts.some(fact => !fact || fact.reference !== id) || new Set(facts.map(fact => JSON.stringify(fact))).size !== 1) return undefined;
    const sections = [...article.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/giu)].map(m => m[0]);
    const selected = ["Descriptif du poste", "Profil recherché", "A propos de notre client"].map(heading => sections.filter(section => {
      const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/iu.exec(section)?.[1];
      return h2 !== undefined && text(h2) === heading;
    }));
    if (selected.some(matches => matches.length !== 1)) return undefined;
    const bounded = titles[0]! + cards[0]! + selected.flat().join("\n");
    if (/<(?:nav|footer|form|input|select|article)\b/iu.test(bounded)) return undefined;
    for (const link of bounded.matchAll(/\bhref=["']([^"']+)["']/giu)) {
      try { const linkedId = synergieVacancyId(new URL(link[1]!, input.sourceUrl).href); if (linkedId && linkedId !== id) return undefined; } catch { /* Unrelated link. */ }
    }
    for (const match of bounded.matchAll(/\bdata-(?:job|vacancy|reference)-id=["']([^"']+)["']/giu)) if (match[1] !== id) return undefined;
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    let conflict = false;
    const matching = postings.filter(posting => {
      const rawId = typeof posting.identifier === "string" ? posting.identifier : record(posting.identifier)?.value;
      const postingId = reference(rawId);
      const urlId = typeof posting.url === "string" ? synergieVacancyId(posting.url) : undefined;
      if ((postingId === id && urlId !== undefined && urlId !== id) || (urlId === id && postingId !== undefined && postingId !== id)
        || (postings.length === 1 && postingId !== undefined && postingId !== id)) conflict = true;
      return postingId === id || urlId === id;
    });
    if (conflict) return undefined;
    const posting = matching.length === 1 ? matching[0] : undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "SYNERGIE", providerExternalId: id,
      html: bounded, text: text(bounded), associationEvidence: ["BOUNDED_JOB_DETAIL", "MATCHING_VACANCY_REFERENCE", "SYNERGIE_DIRECT_JOB", ...(posting ? ["MATCHING_JOB_POSTING_REFERENCE"] : [])],
      ...(posting ? { metadata: { matchedBaseSalary: posting.baseSalary } } : {}),
    });
  }
}
export function synergiePublishedAt(html: string): Date | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(synergieFacts(html)?.values["Date de publication"] ?? "");
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return date.getUTCDate() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 ? date : undefined;
}
