import {
  createExtractedVacancyEvidence,
  type ExtractedVacancyEvidence,
} from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import {
  normalizeVacancyEvidenceInput,
  textualEvidenceContent,
  type VacancyEvidenceExtractionInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";
import type { VacancyCompensationEvidence } from "../../domain/evidence/VacancyCompensationEvidence.js";
import type { VacancyEngagementEvidence } from "../../domain/evidence/VacancyEngagementEvidence.js";
import type { VacancyWorkModeEvidence } from "../../domain/evidence/VacancyWorkModeEvidence.js";
import {
  extractIndeedSelectedVacancyFacts,
  isIndeedSelectedVacancyInput,
} from "./IndeedSelectedVacancyEvidenceExtractor.js";

const CONFIDENCE = 0.98;
const SECTION_HEADING = /^(?:description|profil|missions?|responsabilit[eé]s|comp[eé]tences|[àa]\s+propos\s+de\s+l['’]offre\s+d['’]emploi)$/iu;
const TITLE_MARKER = /\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m)\b/iu;

export class CoreVacancyHeaderFactsExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    // These labeled summaries are handled by their provider extractors. A
    // numeric reference (for example 307-UST-...) is not a department/location.
    if (observation.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT"
      && ["RANDSTAD", "SYNERGIE", "CRIT", "ACTUAL", "START_PEOPLE"].includes(observation.evidenceContent.context.providerKey ?? "")) {
      return createExtractedVacancyEvidence({ sourceObservationId: observation.id });
    }
    const { vacancyText, contentOrigin } = textualEvidenceContent(input);
    const isLinkedInSelectedContext =
      observation.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" &&
      observation.evidenceContent.context.providerKey === "LINKEDIN";
    const selectedHeader = isLinkedInSelectedContext
      ? linkedinHeader(vacancyText)
      : vacancyText;
    const lines = selectedHeader.split(/\r?\n/u).map(normalizeLine).filter(Boolean);
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: CONFIDENCE,
      ...(contentOrigin === undefined ? {} : { contentOrigin }),
    };

    const indeedFacts = extractIndeedSelectedVacancyFacts(input);
    const title = indeedFacts?.title ?? (isIndeedSelectedVacancyInput(input)
      ? undefined
      : lines.slice(0, 12).find(isConservativeVacancyTitle));
    const location = indeedFacts?.location ?? (isIndeedSelectedVacancyInput(input)
      ? undefined
      : lines.slice(0, 16).map(extractLocation).find((value) => value !== null));
    const engagement = lines.map(extractEngagement).find((value) => value !== null);
    const workMode = isLinkedInSelectedContext
      ? extractLinkedInHeaderWorkMode(selectedHeader)
      : lines.map(extractWorkMode).find((value) => value !== null);
    const compensation = isLinkedInSelectedContext
      ? extractLinkedInHeaderCompensation(selectedHeader)
      : extractCompensation(vacancyText);

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: title, provenance }] }),
      ...(location === undefined ? {} : { locations: [{ value: location, role: "WORKPLACE", provenance }] }),
      ...(engagement === undefined ? {} : { engagements: [{ ...engagement, provenance }] }),
      ...(workMode === undefined || workMode === null ? {} : { workModes: [{ value: workMode, provenance }] }),
      ...(compensation === null ? {} : { compensations: [{ ...compensation, provenance }] }),
    });
  }
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function isConservativeVacancyTitle(line: string): boolean {
  return line.length >= 5 && line.length <= 160 && !SECTION_HEADING.test(line) && TITLE_MARKER.test(line);
}

function extractLocation(line: string): string | null {
  if (isCompensationLike(line)) return null;
  const department = /^(?:\d{2,3}|2[AB])\s*-\s*(.{2,100})$/iu.exec(line);
  if (department !== null) return normalizeLine(department[1] ?? "") || null;
  const frenchLocation = /^([\p{L}][\p{L}\s'’.-]{2,80}(?:,\s*[\p{L}][\p{L}\s'’.-]{2,80})?,\s*France)(?=\s*(?:·|$))/u.exec(line);
  if (frenchLocation !== null) return normalizeLine(frenchLocation[1] ?? "") || null;
  return null;
}

function isCompensationLike(value: string): boolean {
  return /(?:€|\$|£|\b(?:EUR|USD|GBP)\b)|\/\s*(?:heure|hour|an|year|mois|month)\b|\b\d+(?:[.,]\d+)?\s*[kK]?\s*[–-]\s*\d+(?:[.,]\d+)?\b/iu.test(value);
}

function extractEngagement(line: string): Omit<VacancyEngagementEvidence, "provenance"> | null {
  if (/\b(?:mission\s+d['’]int[eé]rim|contrat\s+int[eé]rimaire|int[eé]rim)\b/iu.test(line)) {
    return { rawTerms: [normalizeLine(line)], normalizedTerms: ["INTERIM"] };
  }
  const terms = [
    ...(/\bCDI\b/iu.test(line) ? [["CDI", "INDEFINITE"] as const] : []),
    ...(/\bCDD\b/iu.test(line) ? [["CDD", "FIXED_TERM"] as const] : []),
    ...(/\btemps\s+plein\b/iu.test(line) ? [["Temps plein", "FULL_TIME"] as const] : []),
    ...(/\btemps\s+partiel\b/iu.test(line) ? [["Temps partiel", "PART_TIME"] as const] : []),
  ];
  return terms.length === 0 ? null : {
    rawTerms: terms.map(([raw]) => raw), normalizedTerms: terms.map(([, normalized]) => normalized),
  };
}

function extractWorkMode(line: string): VacancyWorkModeEvidence["value"] | null {
  if (/^sur\s+site$/iu.test(line)) return "ON_SITE";
  if (/^hybride$/iu.test(line)) return "HYBRID";
  if (/^(?:t[eé]l[eé]travail|[àa]\s+distance|remote)$/iu.test(line)) return "REMOTE";
  return null;
}

function linkedinHeader(text: string): string {
  return text.split(/\n[ \t]*[ÀA] propos de l['’]offre d['’]emploi[ \t]*\n/iu)[0] ?? text;
}

function extractLinkedInHeaderWorkMode(
  header: string,
): VacancyWorkModeEvidence["value"] | null {
  const normalized = normalizeLine(header);
  if (/(?:^|[·\s])sur\s+site(?=$|[·\s])/iu.test(normalized)) return "ON_SITE";
  if (/(?:^|[·\s])hybride(?=$|[·\s])/iu.test(normalized)) return "HYBRID";
  if (/(?:^|[·\s])(?:t[eé]l[eé]travail|[àa]\s+distance|remote)(?=$|[·\s])/iu.test(normalized)) return "REMOTE";
  return null;
}

type ExtractedCompensation = Pick<
  VacancyCompensationEvidence,
  "rawText" | "currency" | "minimum" | "maximum" | "period"
>;

function extractLinkedInHeaderCompensation(text: string): ExtractedCompensation | null {
  const localizedRange =
    /(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s*[kK]\s*€\s*(?:par\s+yr|per\s+year|par\s+an)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*[kK]\s*€\s*(?:par\s+yr|per\s+year|par\s+an)(?![\p{L}])/iu.exec(text);
  if (localizedRange !== null) {
    const amount = (value: string) => Number(value.replace(",", ".")) * 1000;
    return {
      rawText: normalizeLine(localizedRange[0]),
      currency: "EUR",
      minimum: amount(localizedRange[1]!),
      maximum: amount(localizedRange[2]!),
      period: "YEAR",
    };
  }
  return extractCompensation(text);
}

function extractCompensation(text: string): ExtractedCompensation | null {
  const annual = /\bSalaire\s+brut\s*:\s*Annuel\s+de\s+([\d ]+(?:[.,]\d+)?)\s+Euros?\s+[àa]\s+([\d ]+(?:[.,]\d+)?)\s+Euros?\b/iu.exec(text);
  const compactRange = /(?<!\d)(?<![.,])(?<!\d[ \u00a0\u202f])(\d+(?:[.,]\d+)?)k\s*[–-]\s*(\d+(?:[.,]\d+)?)k\s*€\s*\/\s*(h|heure|mois|an|ann[eé]e)\b/iu.exec(text);
  const groupedNumber = "\\d+(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d+)?";
  const range = new RegExp(`(?<!\\d)(?<![.,])(?<!\\d[ \\u00a0\\u202f])(${groupedNumber})\\s*[àa\\-–]\\s*(${groupedNumber})\\s*(?:€|EUR|USD|GBP)\\s*\\/?\\s*(h|heure|mois|an|ann[eé]e|year)\\b`, "iu").exec(text);
  const common = compactRange ?? range ?? new RegExp(`(?<!\\d)(?<![.,])(?<!\\d[ \\u00a0\\u202f])(${groupedNumber})\\s*(?:k)?\\s*(?:€|EUR|USD|GBP)\\s*(?:[àa\\-–]\\s*(${groupedNumber})\\s*(k)?\\s*(?:€|EUR|USD|GBP))?\\s*\\/?\\s*(h|heure|mois|an|ann[eé]e|year)\\b`, "iu").exec(text);
  const match = annual ?? common;
  if (match === null) return null;
  const annualMatch = annual !== null;
  const factor = !annualMatch && /k/iu.test(match[0]) ? 1000 : 1;
  const minimum = parseCompensationNumber(match[1]!) * factor;
  const maximum = match[2] === undefined ? undefined : parseCompensationNumber(match[2]) * (range !== null || compactRange !== null ? factor : match[3] === undefined ? factor : 1000);
  function parseCompensationNumber(value: string): number {
    const compact = value.replace(/[ \u00a0\u202f]/gu, "");
    const grouping = /[.,]\d{3}$/u.test(compact) && !/[.,]\d{1,2}$/u.test(compact);
    if (grouping) return Number(compact.replace(/[.,]/gu, ""));
    return Number(compact.replace(",", "."));
  }
  const unit = annualMatch ? "YEAR" : match[range !== null || compactRange !== null ? 3 : 4]?.toLocaleLowerCase();
  return {
    rawText: normalizeLine(match[0]),
    currency: "EUR",
    minimum,
    ...(maximum === undefined ? {} : { maximum }),
    period: unit === "h" || unit === "heure" ? "HOUR" : unit === "mois" ? "MONTH" : "YEAR",
  };
}
