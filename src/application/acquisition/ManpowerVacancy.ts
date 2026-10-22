import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { adeccoElementsWithClass as elements } from "./AdeccoSelectedVacancyContextLocator.js";

export function manpowerVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    if (!/^(?:www\.)?manpower\.com$/u.test(url.hostname) || !["https:", "http:"].includes(url.protocol)) return undefined;
    return /^\/en\/job\/[^/]+\/[^/]+\/(\d+)\/?$/u.exec(url.pathname)?.[1];
  } catch { return undefined; }
}

function text(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
}
function single(html: string, name: string): string | undefined {
  const found = elements(html, name);
  return found.length === 1 ? found[0] : undefined;
}

export function manpowerFacts(html: string) {
  const header = single(html, "article-header-container");
  const description = single(html, "details-rich-text");
  const location = single(html, "location-sidebar");
  const company = single(html, "company");
  if (!header || !description || !location || !company) return undefined;
  const titles = [...header.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  if (titles.length !== 1 || !text(titles[0]![1]!)) return undefined;
  const values = new Map<string, string>();
  for (const row of elements(header, "job-details-text")) {
    const match = /^(Reference Number|Published Date|Job Type|Industry|Hours):\s*(.+)$/u.exec(text(row));
    if (!match || values.has(match[1]!)) return undefined;
    values.set(match[1]!, match[2]!);
  }
  const reference = values.get("Reference Number");
  const address = single(location, "address");
  if (!/^\d+$/u.test(reference ?? "") || !address || !text(address)) return undefined;
  const logos = [...company.matchAll(/<img\b[^>]*\balt=["'](Manpower(?: Engineering)?)["'][^>]*>/gu)];
  const recruiter = single(html, "recruiter-name");
  // A paragraph may contain several labeled facts separated by explicit breaks.
  // Preserve those boundaries before flattening inline markup to text.
  const pay = [...description.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .flatMap((m) => m[1]!.split(/<br\b[^>]*>/giu)).map(text).filter((line) => /^Pay Range:/u.test(line));
  if (pay.length > 1) return undefined;
  const date = /<time\b[^>]*datetime=["']([^"']+)["']/u.exec(header)?.[1];
  return { title: text(titles[0]![1]!), reference: reference!, location: text(address), contract: values.get("Job Type"),
    hours: values.get("Hours"), industry: values.get("Industry"), salary: pay[0]?.replace(/^Pay Range:\s*/u, ""),
    publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date) : undefined,
    agency: logos.length === 1 && /\bour client\b/iu.test(text(description)) ? logos[0]![1] : undefined,
    recruiter: recruiter ? text(recruiter) : undefined };
}

export class ManpowerSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = manpowerVacancyId(input.sourceUrl);
    if (input.providerKey !== "MANPOWER" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const clean = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
    const mains = [...clean.matchAll(/<main\b[^>]*>[\s\S]*?<\/main\s*>/giu)];
    if (mains.length !== 1) return undefined;
    const main = mains[0]![0];
    if (elements(main, "job-header").length !== 1 || elements(main, "details-block").length !== 1
      || elements(main, "single-job").length !== 1 || elements(main, "recruiter-sidebar").length > 1
      || [...main.matchAll(/<h1\b/giu)].length !== 1 || elements(main, "job-card").length > 0
      || /<(?:footer|input|select)\b/iu.test(main)) return undefined;
    const details = single(main, "details-block")!;
    if (!single(single(main, "job-header")!, "article-header-container") || !single(details, "details-rich-text")
      || !single(details, "company") || !single(details, "location-sidebar")) return undefined;
    const facts = manpowerFacts(main);
    if (!facts || facts.reference !== id) return undefined;
    for (const tag of main.matchAll(/<[a-z][\w-]*\b[^>]*>/giu)) {
      for (const reference of tag[0].matchAll(/\bdata-(?:job|vacancy|reference)-id=["']([^"']+)["']/giu)) {
        if (reference[1] !== id) return undefined;
      }
    }
    for (const link of main.matchAll(/\bhref=["']([^"']+)["']/giu)) {
      try {
        const linkedId = manpowerVacancyId(new URL(link[1]!.replaceAll("&amp;", "&"), input.sourceUrl).href);
        if (linkedId && linkedId !== id) return undefined;
      } catch { /* Non-vacancy links do not establish identity. */ }
    }
    // Reassemble only the verified job regions, excluding breadcrumb/actions and
    // any additional main-page siblings. Keep recruiter email in source context.
    const originalHeader = single(main, "article-header-container")!;
    const header = `<div class="article-header-container">${originalHeader.match(/<h1\b[\s\S]*?<\/h1>/iu)?.[0]}${single(originalHeader, "job-details-list") ?? ""}</div>`;
    const bounded = [header, single(main, "details-rich-text"), single(main, "company"), single(main, "location-sidebar"), single(main, "recruiter-sidebar")].filter(Boolean).join("\n");
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "MANPOWER",
      providerExternalId: id, html: bounded, text: bounded.replace(/<\/(?:p|div|li|h[1-6])>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/[ \t]+/gu, " ").trim(),
      associationEvidence: ["BOUNDED_JOB_DETAIL", "MATCHING_VACANCY_REFERENCE", "MANPOWER_DIRECT_JOB"] });
  }
}
