import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
export function stellantisVacancyId(sourceUrl: string): string | undefined {
  try { const u = new URL(sourceUrl); return u.hostname === "jobs.groupe-psa.com" && /^https?:$/u.test(u.protocol) ? /^\/offre-de-emploi\/emploi-[^/]+_([1-9]\d*)\.aspx$/u.exec(u.pathname)?.[1] : undefined; } catch { return undefined; }
}
function one(html: string, cls: string) { const all = elements(html, cls); return all.length === 1 ? all[0] : undefined; }
function field(html: string, id: string) {
  const matches = [...html.matchAll(new RegExp(`<p\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/p>`, "giu"))];
  return matches.length === 1 ? { html: matches[0]![0], value: text(matches[0]![1]!), index: matches[0]!.index! } : undefined;
}
function hidden(part: string) { return /\s(?:hidden(?:[\s=>])|aria-hidden=["']true["'])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(part.slice(0, part.indexOf(">") + 1)); }
export function stellantisFacts(html: string) {
  const content = one(html, "ts-offer-page__content"), referenceHtml = one(html, "ts-offer-page__reference");
  if (!content || !referenceHtml || hidden(content) || hidden(referenceHtml) || /<(?:nav|aside|input|select|form)\b/iu.test(content)) return undefined;
  const title = field(content, "fldjobdescription_jobtitle")?.value;
  const description = field(content, "fldjobdescription_description1"), profile = field(content, "fldjobdescription_description2");
  const reference = text(referenceHtml).replace(/^Référence\s*/u, "");
  if (!title || !description?.value || !profile?.value || !/^\d{4}-[1-9]\d*$/u.test(reference)) return undefined;
  const locationBlocks = elements(content, "ts-offer-page__block").filter(b => /<h2\b[^>]*class=["']Location["']/u.test(b));
  let city: string | undefined;
  if (locationBlocks.length === 1) {
    const block = locationBlocks[0]!, location = field(block, "fldlocation_joblocation");
    if (location && !hidden(block)) {
      city = location.value || undefined;
      // Browser-repaired <p><div>Poissy</div></p>: the value is a sibling of the empty field marker.
      if (!city) {
        const tail = block.slice(location.index + location.html.length);
        const repaired = /^\s*<div\b[^>]*>([^<>]+)<\/div>\s*<p>\s*<\/p>\s*<\/div>$/iu.exec(tail);
        if (repaired) city = text(repaired[1]!);
      }
    }
  }
  return { title, content, referenceHtml, reference, description: description.value, profile: profile.value, city,
    contract: field(content, "fldjobdescription_contract")?.value,
    professionalStatus: field(content, "fldjobdescription_professionalcategory")?.value,
    region: field(content, "fldlocation_location_geographicalareacollection")?.value };
}
export class StellantisSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = stellantisVacancyId(input.sourceUrl);
    if (input.providerKey !== "STELLANTIS" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const body = one(clean, "ts-offer-page__body");
    if (!body || hidden(body)) return undefined;
    const facts = stellantisFacts(body);
    if (!facts || facts.reference.split("-")[1] !== id) return undefined;
    const headings = elements(clean, "ts-offer-page__title");
    if (headings.length < 1 || headings.length > 2 || headings.some(h => text(h.replace(/<div\b[\s\S]*?<\/div>/giu, "")) !== facts.title)) return undefined;
    const printLinks = [...body.matchAll(/<a\b[^>]*\bid=["']lnk_Imprimer["'][^>]*>/giu)];
    if (printLinks.length !== 1) return undefined;
    const href = /\bhref=["']([^"']+)["']/u.exec(printLinks[0]![0])?.[1];
    try { const u = new URL(href ?? "", input.sourceUrl); if (stellantisVacancyId(u.href.replace('/imprimer-fiche-emploi-', '/emploi-')) !== id) return undefined; } catch { return undefined; }
    const selected = facts.content + facts.referenceHtml;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "STELLANTIS", providerExternalId: id,
      html: selected, text: text(selected), associationEvidence: ["BOUNDED_STELLANTIS_VACANCY", "MATCHING_DISPLAYED_REFERENCE", "MATCHING_PRINT_ROUTE", "AGREEING_VISIBLE_TITLES"],
      metadata: { displayedReference: facts.reference, professionalStatus: facts.professionalStatus, locationEvidence: facts.city ? "VISIBLE_VILLE_FIELD" : undefined, regionText: facts.region } });
  }
}
