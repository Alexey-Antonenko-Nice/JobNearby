import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { alstomElements as elements } from "./AlstomVacancy.js";
import { randstadText } from "./RandstadVacancy.js";
import { LiteralJsonLdDocumentExtractor } from "./LiteralJsonLdDocumentExtractor.js";
import { SchemaOrgJobPostingExtractor } from "./SchemaOrgJobPostingExtractor.js";

export function expectraVacancyId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?expectra\.mc$/u.test(url.hostname) || !["http:", "https:"].includes(url.protocol)) return undefined;
    return /^\/offre-emploi\/([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*\/?$/iu.exec(url.pathname)?.[1];
  } catch { return undefined; }
}

function attr(open: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "iu").exec(open)?.[1];
}
function hasClass(open: string, name: string) { return attr(open, "class")?.split(/\s+/u).includes(name) === true; }
function hidden(html: string) {
  return /\s+hidden(?:\s|=|>)|\baria-hidden=["']true["']|\bstyle=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(html);
}
function flat(html: string) { return randstadText(html).replace(/\s+/gu, " ").trim(); }

export function expectraFacts(html: string) {
  const headers = elements(html, open => hasClass(open, "intro"));
  const bands = elements(html, open => hasClass(open, "band-offer"));
  if (headers.length !== 1 || bands.length !== 1) return undefined;
  const header = headers[0]!, band = bands[0]!;
  if (hidden(band.slice(0, band.indexOf(">") + 1))) return undefined;
  const columns = elements(band, open => hasClass(open, "col-12") && hasClass(open, "col-md-8"));
  const titles = elements(header, (_open, tag) => tag === "h1");
  if (columns.length !== 1 || titles.length !== 1 || hidden(header) || hidden(columns[0]!)) return undefined;
  const title = flat(titles[0]!);
  if (!title || title.length > 250) return undefined;
  const column = columns[0]!;
  const headings = elements(column, (open, tag) => tag === "h3" && hasClass(open, "custom"));
  const expected = ["Description du poste", "Profil recherché", "À propos de la société"];
  if (headings.length !== expected.length || headings.some((heading, i) => flat(heading) !== expected[i])) return undefined;
  const sections: string[] = [];
  for (const heading of headings) {
    const index = column.indexOf(heading);
    const remainder = column.slice(index + heading.length);
    const paragraph = /^\s*(<p\b[^>]*>[\s\S]*?<\/p>)/iu.exec(remainder)?.[1];
    if (!paragraph || hidden(heading + paragraph) || !flat(paragraph) || /<(?:nav|aside|footer|form|input|script|style)\b/iu.test(paragraph)) return undefined;
    sections.push(heading + paragraph);
  }
  const selected = `<div class="intro">${titles[0]}</div><div class="band-offer"><div class="col-12 col-md-8">${sections.join("\n")}</div></div>`;
  return { title, html: selected, text: randstadText(selected) };
}

export class ExpectraSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = expectraVacancyId(input.sourceUrl);
    if (input.providerKey !== "EXPECTRA_MONACO" || !id || input.externalId !== undefined && input.externalId !== id) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const facts = expectraFacts(clean);
    if (!facts) return undefined;
    const pageTitles = elements(clean, (_open, tag) => tag === "title");
    if (pageTitles.length > 1) return undefined;
    const titleRefs = pageTitles.flatMap(title => [...flat(title).matchAll(/\[#(\d+)\]/gu)].map(match => match[1]!));
    if (titleRefs.some(ref => ref !== id)) return undefined;
    const canonical = [...clean.matchAll(/<link\b[^>]*>/giu)].filter(match => attr(match[0], "rel") === "canonical");
    if (canonical.length > 1 || canonical.some(match => {
      try { return expectraVacancyId(new URL(attr(match[0], "href") ?? "", input.sourceUrl).href) !== id; } catch { return true; }
    })) return undefined;
    const selected = elements(clean, open => hasClass(open, "intro") || hasClass(open, "band-offer"));
    const explicit = selected.flatMap(part => [...part.matchAll(/\bdata-popup-name=["']postulate(\d+)["']/giu)].map(match => match[1]!));
    explicit.push(...selected.flatMap(part => [...part.matchAll(/\bhref=["']\/add_cart\/(\d+)\/?["']/giu)].map(match => match[1]!)));
    if (explicit.some(ref => ref !== id)) return undefined;
    const postings = new SchemaOrgJobPostingExtractor().extract(new LiteralJsonLdDocumentExtractor().extract(input.html));
    for (const posting of postings) {
      const identifier = typeof posting.identifier === "object" && posting.identifier !== null ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
      const ref = typeof identifier === "string" || typeof identifier === "number" ? String(identifier) : undefined;
      let linked: string | undefined;
      try { linked = typeof posting.url === "string" ? expectraVacancyId(new URL(posting.url, input.sourceUrl).href) : undefined; } catch { return undefined; }
      if ((postings.length === 1 || ref === id || linked === id) &&
        ((identifier !== undefined && ref !== id) || (posting.url !== undefined && linked !== id))) return undefined;
    }
    const logo = elements(clean, open => hasClass(open, "header-expectra"));
    const branding = logo.length === 1 && !hidden(logo[0]!.slice(0, logo[0]!.indexOf(">") + 1))
      && /<img\b[^>]*\bsrc=["']\/images\/logo-expectra\.png["']/iu.test(logo[0]!);
    const sidebar = elements(clean, open => hasClass(open, "col-12") && hasClass(open, "col-md-4"));
    const agency = branding && sidebar.length === 1 && /\bconfiez-nous votre recrutement\b/iu.test(flat(sidebar[0]!));
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "EXPECTRA_MONACO",
      providerExternalId: id, html: facts.html, text: facts.text,
      metadata: { displayedCompanyName: branding ? "Expectra" : undefined, staffingAgency: agency },
      associationEvidence: ["VALIDATED_DETAIL_ROUTE", "BOUNDED_JOB_DETAIL"] });
  }
}
