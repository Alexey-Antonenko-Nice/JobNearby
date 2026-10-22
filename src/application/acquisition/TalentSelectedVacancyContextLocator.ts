import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";

export function talentVacancyId(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    if (!isTalentHostname(url.hostname) || !["http:", "https:"].includes(url.protocol)
      || !/^\/(?:jobs|view)\/?$/u.test(url.pathname)) return undefined;
    const ids = url.searchParams.getAll("id");
    return ids.length > 0 && ids.every((id) => /^\d+$/u.test(id) && id === ids[0]) ? ids[0] : undefined;
  } catch { return undefined; }
}

export class TalentSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = talentVacancyId(input.sourceUrl);
    if (input.providerKey !== "TALENT" || id === undefined || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const html = input.html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
    const hooks = elements(html, "data-hook", "job-card-container");
    if (hooks.length !== 1) return undefined;
    const candidates: string[] = [];
    for (const opening of html.matchAll(/<div\b[^>]*>/giu)) {
      const pane = balancedElement(html, "div", opening.index);
      if (pane === undefined || !pane.includes(hooks[0]!)) continue;
      const children = headerAndDescription(pane);
      if (children === undefined || !children.header.includes(hooks[0]!)) continue;
      // Semantic component shape, not generated styled-component class names.
      if (elements(children.header, "data-customstyle", "mobile-topsection").length !== 1
        || elements(children.description, "tabindex", "0").length !== 1
        || !/<span\b[^>]*>\s*Description de poste\s*<\/span\s*>/iu.test(children.description)
        || talentHeaderFields(pane) === undefined) continue;
      if (/<(?:article|aside|footer)\b/iu.test(pane) || /\saria-current\s*=/iu.test(pane)) return undefined;
      const ids = explicitPaneIds(pane, input.sourceUrl);
      if (ids.size !== 1 || !ids.has(id)) return undefined;
      candidates.push(pane);
    }
    if (candidates.length !== 1) return undefined;
    const pane = candidates[0]!;
    return createAcquisitionContext({ kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "TALENT",
      providerExternalId: id, html: pane, text: talentHtmlToText(pane),
      associationEvidence: ["URL_EXTERNAL_ID", "MATCHING_SELECTED_APPLY_LINK", "BOUNDED_JOB_DETAIL", "TALENT_HEADER_AND_DESCRIPTION"] });
  }
}

export function talentHeaderFields(html: string) {
  const headers = elements(html, "data-hook", "job-card-container");
  if (headers.length !== 1) return undefined;
  // The selected header's direct title/company/location precede metadata/actions.
  const match = /^<div\b[^>]*>\s*<h2\b[^>]*>([\s\S]*?)<\/h2\s*>\s*<span\b[^>]*>([^<]+)<\/span\s*>\s*<span\b[^>]*>([^<]+)<\/span\s*>/iu.exec(headers[0]!);
  if (match === null) return undefined;
  const title = talentHtmlToText(match[1]!);
  const displayedCompanyName = talentHtmlToText(match[2]!);
  const locationText = talentHtmlToText(match[3]!);
  return title && displayedCompanyName && locationText ? { title, displayedCompanyName, locationText } : undefined;
}

function headerAndDescription(pane: string): { header: string; description: string } | undefined {
  const opening = /^<div\b[^>]*>/iu.exec(pane)?.[0];
  if (opening === undefined) return undefined;
  let remaining = pane.slice(opening.length).trimStart();
  if (!/^<header\b/iu.test(remaining)) return undefined;
  const header = balancedElement(remaining, "header", 0);
  if (header === undefined) return undefined;
  remaining = remaining.slice(header.length).trimStart();
  if (!/^<div\b/iu.test(remaining)) return undefined;
  const description = balancedElement(remaining, "div", 0);
  if (description === undefined || !/^<\/div\s*>\s*$/iu.test(remaining.slice(description.length).trimStart())) return undefined;
  return { header, description };
}

function explicitPaneIds(html: string, sourceUrl: string): Set<string> {
  const ids = new Set<string>();
  for (const tag of html.match(/<[a-z][\w-]*\b[^>]*>/giu) ?? []) {
    const newId = attribute(tag, "data-new-id");
    if (newId !== undefined) ids.add(newId);
    // Talent's legacy key has a separate namespace. An unverified pane key
    // cannot establish consistency with the decimal URL id: fail closed.
    const legacy = attribute(tag, "data-job-id");
    if (legacy !== undefined) ids.add(`unverified-legacy:${legacy}`);
    if (!/^<a\b/iu.test(tag)) continue;
    const href = attribute(tag, "href");
    if (!href || href.startsWith("#")) continue;
    try {
      const url = new URL(href.replaceAll("&amp;", "&"), sourceUrl);
      if (!isTalentHostname(url.hostname) || !["http:", "https:"].includes(url.protocol)
        || !/^\/(?:redirect|view|jobs)\/?$/u.test(url.pathname)) continue;
      for (const id of url.searchParams.getAll("id")) if (id) ids.add(id);
    } catch { /* Ignore unrelated malformed links. */ }
  }
  return ids;
}

function isTalentHostname(hostname: string): boolean { return hostname === "talent.com" || /^(?:www|[a-z]{2})\.talent\.com$/u.test(hostname); }

function elements(html: string, name: string, value: string): string[] {
  return [...html.matchAll(/<([a-z][\w-]*)\b[^>]*>/giu)].flatMap((match) => {
    if (attribute(match[0], name) !== value) return [];
    const element = balancedElement(html, match[1]!, match.index);
    return element === undefined ? [] : [element];
  });
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2];
}

function balancedElement(html: string, name: string, start: number): string | undefined {
  const tags = new RegExp(`<\\/?${name}\\b[^>]*>`, "giu");
  tags.lastIndex = start;
  let depth = 0;
  for (let tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return undefined;
}

function talentHtmlToText(html: string): string {
  return html.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|section|span|header)\s*>/giu, "\n").replace(/<[^>]+>/gu, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/giu, (entity, code: string) => {
      if (code.startsWith("#")) {
        const value = /^#x/iu.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      }
      return ({ amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? entity;
    }).replace(/[ \t]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}
