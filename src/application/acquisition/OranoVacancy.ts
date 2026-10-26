import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function oranoVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const id = url.hostname === "jobs.orano.group" && url.protocol === "https:" ? /^\/(?:en_US|fr_FR)\/jobs\/JobDetail\/[^/]+\/([1-9]\d*)\/?$/u.exec(url.pathname)?.[1] : undefined;
    return id && url.searchParams.getAll("jobId").every(value => value === id) ? id : undefined;
  } catch { return undefined; }
}
const text = (html: string) => randstadText(html.replace(/<\/(?:dt|dd|dl)>/giu, "\n")).replace(/[\t ]+/gu, " ");
function one(html: string, cls: string) { const all = elements(html, cls); return all.length === 1 ? all[0] : undefined; }
function section(html: string, id: string) {
  const all = elements(html, "article__content").filter(part => part.slice(0, part.indexOf(">") + 1).includes(`id="${id}"`));
  return all.length === 1 ? all[0] : undefined;
}
export function oranoFacts(html: string) {
  const header = one(html, "banner__text__title");
  const general = section(html, "section0__content"), description = section(html, "section1__content"), benefits = section(html, "section2__content");
  if (!header || !/^<h1\b/iu.test(header) || !general || !description || !benefits) return undefined;
  const values: Record<string, string> = {};
  for (const field of general.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/giu)) {
    const label = one(field[0], "article__content__view__field__label"), value = one(field[0], "article__content__view__field__value");
    if (!label || !value || values[text(label)] !== undefined) return undefined;
    values[text(label)] = text(value);
  }
  const title = text(header), name = values.Name ?? values.Nom;
  const reference = values["Ref #"] ?? values["Référence"];
  const city = values.City ?? values.Ville, region = values.Region ?? values.Région, country = values.Country ?? values.Pays;
  if (!title || title !== name || !reference || !city || !region || !country || !text(description) || !text(benefits)) return undefined;
  const parts = [header, general, description, benefits];
  if (parts.some(part => /\s(?:hidden(?:[\s=>])|aria-hidden=["']true["'])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(part.slice(0, part.indexOf(">") + 1))
    || /<(?:nav|aside|footer|form|input|select)\b/iu.test(part))) return undefined;
  return { title, reference, location: `${city}, ${region}, ${country}`, values, header, general, description, benefits,
    contract: values["Type of Employment"] ?? values["Type de contrat"], publicationText: values["Posting date"] ?? values["Date de publication"],
    remoteWork: values["Remote Work"] ?? values["Télétravail"], desiredStartingDateText: values["Desired Starting Date"] ?? values["Date de début souhaitée"],
    businessUnit: values["Business Unit (BU)"] ?? values["Business Unit"], durationText: values["Durée (Mois)"] };
}
export function oranoPublishedAt(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  // Only the demonstrated English long date; do not interpret ambiguous numeric start dates.
  const match = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/u.exec(value);
  if (!match) return undefined;
  const month = "January February March April May June July August September October November December".split(" ").indexOf(match[1]!);
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  return date.getUTCMonth() === month && date.getUTCDate() === Number(match[2]) ? date : undefined;
}
export class OranoSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = oranoVacancyId(input.sourceUrl);
    if (input.providerKey !== "ORANO" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const facts = oranoFacts(clean);
    if (!facts || facts.reference !== id) return undefined;
    const actions = one(clean, "article--actions");
    const applyLinks = [...(actions ?? "").matchAll(/\bhref=["']([^"']+)["']/giu)];
    if (applyLinks.length !== 1) return undefined;
    try {
      const url = new URL(applyLinks[0]![1]!.replace(/&amp;/gu, "&"), input.sourceUrl);
      if (url.hostname !== "jobs.orano.group" || !/^\/(?:en_US|fr_FR)\/jobs\/ApplicationMethods$/u.test(url.pathname)
        || url.searchParams.getAll("jobId").length !== 1 || url.searchParams.get("jobId") !== id) return undefined;
    } catch { return undefined; }
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    for (const posting of postings) {
      const identifier = typeof posting.identifier === "object" && posting.identifier !== null ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      if ((identifier !== undefined && String(identifier) !== id) || (posting.url !== undefined && (typeof posting.url !== "string" || oranoVacancyId(posting.url) !== id))) return undefined;
    }
    const selected = facts.header + facts.general + facts.description + facts.benefits;
    const durationMonths = /^\d+$/u.test(facts.durationText ?? "") ? Number(facts.durationText) : undefined;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "ORANO", providerExternalId: id,
      html: selected, text: text(selected), associationEvidence: ["BOUNDED_ORANO_DETAILS", "MATCHING_DISPLAYED_REFERENCE", "MATCHING_APPLY_REFERENCE", "AGREEING_VISIBLE_TITLES"],
      metadata: { publicationText: facts.publicationText, durationText: facts.durationText, durationMonths, desiredStartingDateText: facts.desiredStartingDateText,
        remoteWorkText: facts.remoteWork, businessUnit: facts.businessUnit,
        alternativeStructuredTitles: postings.map(posting => posting.title).filter(title => typeof title === "string" && title !== facts.title) } });
  }
}
