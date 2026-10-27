import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";
import { randstadText as text } from "./RandstadVacancy.js";
export const GREENHOUSE_HOST = "job-boards.eu.greenhouse.io";
function identity(sourceUrl: string, base?: string) {
  try {
    const url = new URL(sourceUrl, base);
    const match = /^\/([a-z0-9_-]+)\/jobs\/([1-9]\d*)\/?$/u.exec(url.pathname);
    return url.hostname === GREENHOUSE_HOST && /^https?:$/u.test(url.protocol) && match ? { tenant: match[1]!, id: match[2]! } : undefined;
  } catch { return undefined; }
}
export function greenhouseVacancyId(sourceUrl: string) { return identity(sourceUrl)?.id; }
function one(html: string, cls: string) { const all = elements(html, cls); return all.length === 1 ? all[0] : undefined; }
function hidden(html: string) {
  return /\s(?:hidden(?:[\s=>])|aria-hidden=["']true["'])|\bstyle=["'][^"']*display\s*:\s*none/iu.test(html.slice(0, html.indexOf(">") + 1));
}
export function greenhouseFacts(html: string) {
  const titleRegion = one(html, "job__title"), descriptionHtml = one(html, "job__description");
  if (!titleRegion || !descriptionHtml) return undefined;
  const headings = [...titleRegion.matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/giu)];
  const locationHtml = one(titleRegion, "job__location");
  if (headings.length !== 1 || !locationHtml) return undefined;
  const title = text(headings[0]![0]), location = text(locationHtml), description = text(descriptionHtml);
  if (!title || !location || !description || hidden(headings[0]![0]) || hidden(locationHtml)) return undefined;
  for (const part of [titleRegion, descriptionHtml]) {
    if (hidden(part)
      || /<(?:form|input|select|nav|aside|footer)\b/iu.test(part)) return undefined;
  }
  return { title, location, description, titleRegion, descriptionHtml };
}
export class GreenhouseSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const route = identity(input.sourceUrl);
    if (input.providerKey !== "GREENHOUSE" || !route || (input.externalId !== undefined && input.externalId !== route.id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
    const page = one(clean, "job-post-container");
    const facts = page ? greenhouseFacts(page) : undefined;
    if (!page || hidden(page) || !facts) return undefined;
    const matches = (url: string) => { const found = identity(url.replace(/&amp;/gu, "&"), input.sourceUrl); return found?.id === route.id && found.tenant === route.tenant; };
    const canonical = [...clean.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*>/giu)];
    if (canonical.length !== 1 || !matches(/\bhref=["']([^"']+)["']/u.exec(canonical[0]![0])?.[1] ?? "")) return undefined;
    const forms = [...page.matchAll(/<form\b[^>]*\bid=["']application-form["'][^>]*>/giu)];
    if (forms.length !== 1 || !matches(/\baction=["']([^"']+)["']/u.exec(forms[0]![0])?.[1] ?? "")) return undefined;
    for (const tag of clean.matchAll(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/giu)) {
      if (!matches(/\bcontent=["']([^"']+)["']/u.exec(tag[0])?.[1] ?? "")) return undefined;
    }
    const selected = facts.titleRegion + facts.descriptionHtml;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "GREENHOUSE", providerExternalId: route.id,
      html: selected, text: [facts.title, facts.location, facts.description].join("\n"), metadata: { tenant: route.tenant },
      associationEvidence: ["BOUNDED_GREENHOUSE_JOB", "MATCHING_CANONICAL_ROUTE", "MATCHING_APPLICATION_ROUTE"] });
  }
}
