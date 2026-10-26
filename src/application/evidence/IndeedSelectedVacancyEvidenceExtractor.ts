import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import {
  fromSelectedVacancyContext,
  normalizeVacancyEvidenceInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";
import { indeedElementsWithAttribute, htmlToIndeedText } from "../acquisition/IndeedSelectedVacancyContextLocator.js";

const CONFIDENCE = 1;

export interface IndeedSelectedVacancyFacts {
  readonly title?: string;
  readonly company?: string;
  readonly location?: string;
}

export class IndeedSelectedVacancyEvidenceExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const facts = extractIndeedSelectedVacancyFacts(input);
    if (facts === undefined) {
      return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    }
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: CONFIDENCE,
      contentOrigin: "SELECTED_VACANCY_CONTEXT" as const,
    };
    const context = selectedIndeedContext(input)!;
    const selectedText = context.text ?? htmlToIndeedText(context.html ?? "");
    const compensation = companyJobsHeaderCompensation(context.html ?? "") ?? selectedCompensation(selectedText);
    const workMode = headerWorkMode(selectedText);
    const terms = [
      ...(/\bCDI\b/iu.test(selectedText) ? [["CDI", "INDEFINITE"] as const] : []),
      ...(/\bCDD\b/iu.test(selectedText) ? [["CDD", "FIXED_TERM"] as const] : []),
      ...(/\btemps\s+plein\b/iu.test(selectedText) ? [["temps plein", "FULL_TIME"] as const] : []),
      ...(/\btemps\s+partiel\b/iu.test(selectedText) ? [["temps partiel", "PART_TIME"] as const] : []),
    ];
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(facts.title === undefined ? {} : { vacancyTitles: [{ value: facts.title, provenance }] }),
      ...(facts.company === undefined ? {} : { organizations: [{ value: facts.company, role: selfIdentifiedEmployer(selectedText, facts.company) ? "EMPLOYER" : "UNKNOWN", provenance }] }),
      ...(facts.location === undefined ? {} : { locations: [{ value: facts.location, role: "WORKPLACE", provenance }] }),
      ...(workMode === undefined ? {} : { workModes: [{ value: workMode, provenance }] }),
      ...(terms.length === 0 ? {} : { engagements: [{ rawTerms: terms.map(([raw]) => raw), normalizedTerms: terms.map(([, value]) => value), provenance }] }),
      ...(compensation === undefined ? {} : { compensations: [{ ...compensation, provenance }] }),
    });
  }
}

export function extractIndeedSelectedVacancyFacts(
  input: VacancyEvidenceExtractionInput,
): IndeedSelectedVacancyFacts | undefined {
  const context = selectedIndeedContext(input);
  if (context === undefined || context.html === undefined) return undefined;
  const title = firstSemanticText(context.html, [
    /data-testid\s*=\s*["']jobDetailTitle["']/u,
    /data-testid\s*=\s*["']vj-job-title["']/iu,
    /(?:data-testid|data-test-id)\s*=\s*["'][^"']*(?:jobtitle|jobinfoheader-title)[^"']*["']/iu,
    /class\s*=\s*["'][^"']*jobsearch-JobInfoHeader-title[^"']*["']/iu,
  ]) ?? firstHeadingWithJobPostSuffix(context.html);
  const companyJobsSubtitle = selectedCompanyJobsSubtitle(context.html);
  const company = firstSemanticText(context.html, [
    /data-testid\s*=\s*["']vj-company-name["']/iu,
    /(?:data-testid|data-test-id)\s*=\s*["'][^"']*inlineHeader-companyName[^"']*["']/iu,
    /href\s*=\s*["'][^"']*\/cmp\/[^"']*fromjk=[^"']*["']/iu,
  ]) ?? companyJobsSubtitle?.company;
  const location = firstSemanticText(context.html, [
    /(?:data-testid|data-test-id)\s*=\s*["'][^"']*(?:inlineHeader-companyLocation|job-location)[^"']*["']/iu,
  ]) ?? companyJobsSubtitle?.location ?? nativeHeaderLocation(context.html) ?? headerAddressLocation(context.text ?? htmlToText(context.html)) ?? firstPostalLocation(context.text ?? htmlToText(context.html));
  return {
    ...(title === undefined ? {} : { title: stripIndeedJobPostSuffix(title) }),
    ...(company === undefined ? {} : { company }),
    ...(location === undefined ? {} : { location }),
  };
}

function selectedCompanyJobsSubtitle(html: string): { company: string; location: string } | undefined {
  const subtitles = indeedElementsWithAttribute(html, "data-testid", "jobDetailSubtitle");
  if (subtitles.length !== 1) return undefined;
  // The company-jobs pane labels company and locality together. Split only at
  // its explicit separator and a French department-qualified locality.
  const match = /^(.+)\s+-\s+([\p{L}][\p{L}\s'’.-]{1,80}\s*\(\d{2,3}\))$/u.exec(normalizeText(htmlToIndeedText(subtitles[0]!)));
  return match === null ? undefined : { company: match[1]!.trim(), location: match[2]!.trim() };
}

function companyJobsHeaderCompensation(html: string) {
  const heads = indeedElementsWithAttribute(html, "data-testid", "JobDetailHead");
  if (heads.length !== 1) return undefined;
  // Salary and the apply action are inline siblings on company jobs pages.
  // Read the explicit salary span instead of joining it with button text.
  const salaries = [...heads[0]!.matchAll(/<span\b[^>]*>([^<]+)<\/span>/giu)]
    .map((match) => selectedCompensation(htmlToIndeedText(match[1]!))).filter((value) => value !== undefined);
  return salaries.length === 1 ? salaries[0] : undefined;
}

function nativeHeaderLocation(html: string): string | undefined {
  const metadata = indeedElementsWithAttribute(html, "data-testid", "company-info-metadata");
  if (metadata.length !== 1) return undefined;
  // A company anchor can sit directly before the locality's block element.
  // Preserve that block boundary rather than joining company and location.
  return htmlToIndeedText(metadata[0]!.replace(/<div\b/giu, "\n<div")).split(/\r?\n/u).map(normalizeText)
    .find((line) => /^[\p{L}][\p{L}\s'’.-]{1,80}\s*\(\d{2,3}\)$/u.test(line));
}

function selectedCompensation(text: string) {
  const number = "\\d+(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d{1,2})?";
  const pattern = new RegExp(`(?:^|\\n)[ \\t]*((?:De\\s+)?(${number})\\s*€\\s*[àa]\\s*(${number})\\s*€\\s+par\\s+(mois|an|heure))(?=\\s*(?:\\n|$))`, "iu");
  const match = pattern.exec(text);
  if (match === null) return undefined;
  const amount = (value: string) => Number(value.replace(/\s/gu, "").replace(",", "."));
  const minimum = amount(match[2]!);
  const maximum = amount(match[3]!);
  if (!Number.isFinite(minimum) || minimum <= 0 || maximum < minimum) return undefined;
  return { rawText: normalizeText(match[1]!), currency: "EUR", minimum, maximum,
    period: match[4]!.toLowerCase() === "mois" ? "MONTH" as const : match[4]!.toLowerCase() === "heure" ? "HOUR" as const : "YEAR" as const };
}

export function isIndeedSelectedVacancyInput(input: VacancyEvidenceExtractionInput): boolean {
  return selectedIndeedContext(input) !== undefined;
}

function selectedIndeedContext(input: VacancyEvidenceExtractionInput) {
  const observation = normalizeVacancyEvidenceInput(input);
  if (observation.evidenceContent.kind !== "SELECTED_VACANCY_CONTEXT") return undefined;
  const context = fromSelectedVacancyContext(observation, observation.evidenceContent.context).evidenceContent;
  return context.kind === "SELECTED_VACANCY_CONTEXT" && context.context.providerKey === "INDEED"
    ? context.context
    : undefined;
}

function firstSemanticText(html: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match === null || match.index === undefined) continue;
    const tagStart = html.lastIndexOf("<", match.index);
    const tagEnd = html.indexOf(">", match.index);
    if (tagStart < 0 || tagEnd < 0) continue;
    const tagName = /^<([a-z][\w-]*)/iu.exec(html.slice(tagStart, tagEnd + 1))?.[1];
    if (tagName === undefined) continue;
    const close = new RegExp(`</${tagName}\\s*>`, "iu").exec(html.slice(tagEnd + 1));
    if (close === null || close.index === undefined) continue;
    const text = normalizeText(htmlToText(html.slice(tagEnd + 1, tagEnd + 1 + close.index)));
    if (text.length > 0) return text;
  }
  return undefined;
}

function firstHeadingWithJobPostSuffix(html: string): string | undefined {
  for (const match of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/giu)) {
    const text = normalizeText(htmlToText(match[1] ?? ""));
    if (/-\s*job\s+post$/iu.test(text)) return text;
  }
  return undefined;
}

function headerLines(text: string): string[] {
  const lines = text.split(/\r?\n/u).map(normalizeText).filter((line) => line.length > 0);
  const end = lines.findIndex((line) => /^(?:Continuer pour postuler|D[ée]tails du poste|Description du poste)$/iu.test(line));
  return lines.slice(0, end < 0 ? 0 : end);
}

// Only the bounded header above "Détails du poste" is read, never the description.
function headerAddressLocation(text: string): string | undefined {
  return headerLines(text).find((line) =>
    /^(?:[\p{L}\d][\p{L}\d\s'’.-]{0,60},\s*)?\d{5}\s+[\p{L}][\p{L}'’.-]*(?:[\s-]+[\p{L}'’.-]+){0,4}$/u.test(line)
    && !/€/u.test(line));
}

// "Télétravail partiel" is qualified remote work: partly on site, so never REMOTE.
function headerWorkMode(text: string): "HYBRID" | undefined {
  return headerLines(text).some((line) => /^t[eé]l[eé]travail\s+(?:partiel|hybride|occasionnel)$/iu.test(line))
    ? "HYBRID"
    : undefined;
}

// The vacancy text itself must name the company in the first person and state it is
// hiring for its own teams; recruiter wording keeps the role unclassified.
function selfIdentifiedEmployer(text: string, company: string): boolean {
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (!new RegExp(`(?:^|\\n)\\s*Nous\\s+sommes\\s+${escaped}\\b`, "iu").test(text)) return false;
  if (/\b(?:pour\s+le\s+compte\s+de|notre\s+client|nos\s+clients?\s+recherchent|cabinet\s+de\s+recrutement|int[ée]rim)\b/iu.test(text)) return false;
  return /\bnous\s+recherchons\b[^\n]*\b(?:pour\s+(?:rejoindre|renforcer)\s+)?(?:nos|notre)\s+(?:[ée]quipes?|agence|soci[ée]t[ée])\b/iu.test(text);
}

function firstPostalLocation(text: string): string | undefined {
  for (const line of text.split(/\r?\n/u).map(normalizeText)) {
    if (/^\d{4,5}\s+[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+)*$/u.test(line)) return line;
  }
  return undefined;
}

function stripIndeedJobPostSuffix(value: string): string {
  return normalizeText(value).replace(/\s+-\s*job\s+post$/iu, "").trim();
}

function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section)\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " "));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, (entity) => ({
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
  }[entity.toLocaleLowerCase()] ?? entity));
}
