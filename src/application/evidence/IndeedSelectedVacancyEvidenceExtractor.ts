import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyEvidenceExtractionInput } from "../../domain/evidence/VacancyEvidenceInput.js";
import {
  fromSelectedVacancyContext,
  normalizeVacancyEvidenceInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";

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
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(facts.title === undefined ? {} : { vacancyTitles: [{ value: facts.title, provenance }] }),
      ...(facts.company === undefined ? {} : { organizations: [{ value: facts.company, role: "UNKNOWN", provenance }] }),
      ...(facts.location === undefined ? {} : { locations: [{ value: facts.location, role: "WORKPLACE", provenance }] }),
    });
  }
}

export function extractIndeedSelectedVacancyFacts(
  input: VacancyEvidenceExtractionInput,
): IndeedSelectedVacancyFacts | undefined {
  const context = selectedIndeedContext(input);
  if (context === undefined || context.html === undefined) return undefined;
  const title = firstSemanticText(context.html, [
    /(?:data-testid|data-test-id)\s*=\s*["'][^"']*(?:jobtitle|jobinfoheader-title)[^"']*["']/iu,
    /class\s*=\s*["'][^"']*jobsearch-JobInfoHeader-title[^"']*["']/iu,
  ]) ?? firstHeadingWithJobPostSuffix(context.html);
  const company = firstSemanticText(context.html, [
    /(?:data-testid|data-test-id)\s*=\s*["'][^"']*inlineHeader-companyName[^"']*["']/iu,
    /href\s*=\s*["'][^"']*\/cmp\/[^"']*fromjk=[^"']*["']/iu,
  ]);
  const location = firstSemanticText(context.html, [
    /(?:data-testid|data-test-id)\s*=\s*["'][^"']*(?:inlineHeader-companyLocation|job-location)[^"']*["']/iu,
  ]) ?? firstPostalLocation(context.text ?? htmlToText(context.html));
  return {
    ...(title === undefined ? {} : { title: stripIndeedJobPostSuffix(title) }),
    ...(company === undefined ? {} : { company }),
    ...(location === undefined ? {} : { location }),
  };
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