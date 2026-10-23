import { createAcquisitionContext } from "../../domain/acquisition/AcquisitionContext.js";
import type { SelectedVacancyContextLocator } from "./SelectedVacancyContextLocator.js";
import { cleanHtml, htmlByClass as byClass, htmlLine as line, jobPostings } from "./ApecVacancy.js";

export const DIRECT_EMPLOI_SOURCE_NAME = "directemploi.com";
const POSTING_ROUTE = /^\/candidatOffre\/(\d{4,12})\/?$/u;
const POSTING_LINK = /candidatOffre(?:\/|%2F)(\d{4,12})\b/giu;

export function isDirectEmploiSource(sourceName: string, sourceUrl: string) {
  try { return sourceName === DIRECT_EMPLOI_SOURCE_NAME && /^(?:www\.)?directemploi\.com$/u.test(new URL(sourceUrl).hostname); } catch { return false; }
}
/** Only the candidate offer route establishes the posting ID; tracking parameters are ignored. */
export function directEmploiPostingId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !/^(?:www\.)?directemploi\.com$/u.test(url.hostname)) return undefined;
    return POSTING_ROUTE.exec(url.pathname)?.[1];
  } catch { return undefined; }
}

function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

// Navigation, forms, share/apply widgets and similar-offer modules are never part of the selected vacancy.
const FOREIGN_MODULE = /<(?:nav|aside|footer|form|input|select|textarea|button)\b|\bfil_ariane\b|\bapplication-form|\bsimilar-offers|\bjob-share\b|\bjob-apply-btn|\bjob-fav-btn|\bmodal\b/iu;

function pageDate(value: string | undefined) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value ?? "");
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2]}-${match[1]}`, date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? { iso, date } : undefined;
}

export function directEmploiFacts(html: string) {
  const clean = cleanHtml(html);
  if (FOREIGN_MODULE.test(clean)) return undefined;
  const headings = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)];
  const headers = byClass(clean, "job-header"), details = byClass(clean, "job-details");
  if (headings.length !== 1 || headers.length !== 1 || details.length !== 1 || !headers[0]!.includes(headings[0]![0])) return undefined;
  const title = line(headings[0]![1]!);
  if (!title || title.length > 300) return undefined;
  const badges = byClass(headers[0]!, "job-badge");
  const badge = (icon: string) => {
    const matching = badges.filter(item => new RegExp(`\\bclass=["'][^"']*\\b${icon}\\b`, "iu").test(item));
    return matching.length === 1 ? line(matching[0]!) : matching.length === 0 ? undefined : null;
  };
  const date = badge("bi-calendar3"), contract = badge("bi-file-earmark-text"), reference = badge("bi-hash");
  if (date === null || contract === null || reference === null || (reference !== undefined && !/^\d{4,12}$/u.test(reference))) return undefined;
  const companies = byClass(headers[0]!, "job-company"), locations = byClass(headers[0]!, "job-location");
  if (companies.length > 1 || locations.length > 1) return undefined;
  const company = companies[0] ? line(companies[0]) : undefined;
  const rawLocation = locations[0] ? line(locations[0]) : undefined;
  const parts = rawLocation?.split(/\s+-\s+/u) ?? [];
  const location = parts.length === 2 ? `${parts[1]}, ${parts[0]}` : rawLocation;
  const sections: Record<string, string> = {};
  for (const section of byClass(details[0]!, "job-section")) {
    const titles = byClass(section, "job-section-title"), contents = byClass(section, "job-section-content");
    if (titles.length !== 1 || contents.length !== 1) return undefined;
    const name = line(titles[0]!);
    if (name in sections) return undefined;
    sections[name] = line(contents[0]!);
  }
  const description = sections["Description de l'offre"];
  if (!description) return undefined;
  const published = pageDate(date);
  return {
    title, ...(company ? { company } : {}), ...(location ? { location } : {}), ...(contract ? { contract } : {}),
    ...(reference ? { reference } : {}), ...(published ? { publishedOn: published } : {}), description, sections, text: line(clean),
  };
}

export type DirectEmploiIdentity =
  | { readonly status: "VALID"; readonly id: string; readonly reference?: string }
  | { readonly status: "CONFLICT"; readonly identifiers: readonly string[] }
  | { readonly status: "UNVERIFIED" };

/** Posting IDs are compared with each other only. The displayed reference is a separate identifier and is never compared with them. */
export function directEmploiIdentity(input: { readonly sourceUrl: string; readonly html: string; readonly externalId?: string }): DirectEmploiIdentity {
  const urlId = directEmploiPostingId(input.sourceUrl);
  if (!urlId) return { status: "UNVERIFIED" };
  const clean = cleanHtml(input.html);
  const found = [urlId];
  if (input.externalId !== undefined) found.push(input.externalId.trim());
  const [header] = byClass(clean, "job-header");
  for (const region of [...byClass(header ?? "", "job-share"), ...byClass(clean, "application-form-card")]) {
    for (const match of region.matchAll(POSTING_LINK)) found.push(match[1]!);
    for (const match of region.matchAll(/\bid_offre\]?["']?[^>]*\bvalue=["'](\d+)["']/giu)) found.push(match[1]!);
  }
  for (const tag of clean.matchAll(/<(?:link|meta)\b[^>]*>/giu)) {
    if (!/\b(?:rel=["']canonical["']|property=["']og:url["'])/iu.test(tag[0])) continue;
    for (const match of (/\b(?:href|content)=["']([^"']+)["']/iu.exec(tag[0])?.[1] ?? "").matchAll(POSTING_LINK)) found.push(match[1]!);
  }
  const postings = jobPostings(input.html);
  const posting = postings.length === 1 ? postings[0] : undefined;
  if (typeof posting?.url === "string") { const id = directEmploiPostingId(posting.url); if (id) found.push(id); else found.push(`INVALID:${posting.url}`); }
  const distinct = [...new Set(found)];
  const references = new Set<string>();
  const badge = header ? byClass(header, "job-badge").filter(item => /\bbi-hash\b/u.test(item)).map(line) : [];
  for (const value of badge) references.add(value);
  const identifier = record(posting?.identifier)?.value ?? posting?.identifier;
  if (typeof identifier === "string" || typeof identifier === "number") references.add(String(identifier).trim());
  if (distinct.length > 1) return { status: "CONFLICT", identifiers: distinct };
  if (references.size > 1) return { status: "CONFLICT", identifiers: [...references] };
  const reference = [...references][0];
  return { status: "VALID", id: urlId, ...(reference ? { reference } : {}) };
}

export function directEmploiPublishedAt(context: { readonly html?: string; readonly metadata?: Readonly<Record<string, unknown>> } | undefined) {
  const published = context?.html ? directEmploiFacts(context.html)?.publishedOn : undefined;
  if (!published) return undefined;
  const raw = record(context?.metadata?.matchedJobPosting)?.datePosted;
  const exact = typeof raw === "string" ? new Date(raw) : undefined;
  return exact && Number.isFinite(exact.getTime()) && /^\d{4}-\d{2}-\d{2}/u.exec(raw as string)?.[0] === published.iso ? exact : published.date;
}

export class DirectEmploiSelectedVacancyContextLocator implements SelectedVacancyContextLocator {
  locate(input: Parameters<SelectedVacancyContextLocator["locate"]>[0]) {
    const id = directEmploiPostingId(input.sourceUrl);
    if (input.providerKey !== "DIRECT_EMPLOI" || !id || (input.externalId !== undefined && input.externalId !== id)) return undefined;
    const identity = directEmploiIdentity({ sourceUrl: input.sourceUrl, html: input.html, externalId: id });
    if (identity.status !== "VALID") return undefined;
    const clean = cleanHtml(input.html);
    const headers = byClass(clean, "job-header"), details = byClass(clean, "job-details");
    if (headers.length !== 1 || details.length !== 1 || [...clean.matchAll(/<h1\b/giu)].length !== 1) return undefined;
    let header = headers[0]!;
    for (const chrome of ["job-share", "job-apply-btn-header", "job-fav-btn-header"]) for (const element of byClass(header, chrome)) header = header.replace(element, "");
    const bounded = `<div class="direct-emploi-selected-vacancy">${header}${details[0]!}</div>`;
    const facts = directEmploiFacts(bounded);
    if (!facts || (facts.reference !== undefined && identity.reference !== facts.reference)) return undefined;
    const candidates = jobPostings(input.html);
    const posting = candidates.length === 1 && line(String(candidates[0]!.title ?? "")) === facts.title
      && (!facts.company || record(candidates[0]!.hiringOrganization)?.name === facts.company) ? candidates[0] : undefined;
    if (candidates.length === 1 && !posting) return undefined;
    const matchedJobPosting = posting ? {
      ...(typeof posting.datePosted === "string" ? { datePosted: posting.datePosted } : {}),
      ...(typeof posting.employmentType === "string" ? { employmentType: posting.employmentType } : {}),
    } : undefined;
    return createAcquisitionContext({
      kind: "SELECTED_VACANCY", associationMethod: "PROVIDER_LOCATOR", providerKey: "DIRECT_EMPLOI", providerExternalId: id,
      html: bounded, text: facts.text,
      metadata: { postingId: id, ...(facts.reference ? { displayedReference: facts.reference } : {}), ...(matchedJobPosting ? { matchedJobPosting } : {}) },
      associationEvidence: ["BOUNDED_JOB_DETAIL", "DIRECT_EMPLOI_OFFER_URL_ID", "VACANCY_HEADING_TITLE", ...(posting ? ["MATCHED_JOB_POSTING"] : [])],
    });
  }
}
