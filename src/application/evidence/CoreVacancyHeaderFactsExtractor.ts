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

const CONFIDENCE = 0.98;
const SECTION_HEADING = /^(?:description|profil|missions?|responsabilit[eé]s|comp[eé]tences|[àa]\s+propos\s+de\s+l['’]offre\s+d['’]emploi)$/iu;
const TITLE_MARKER = /\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m)\b/iu;

export class CoreVacancyHeaderFactsExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const { vacancyText, contentOrigin } = textualEvidenceContent(input);
    const lines = vacancyText.split(/\r?\n/u).map(normalizeLine).filter(Boolean);
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: CONFIDENCE,
      ...(contentOrigin === undefined ? {} : { contentOrigin }),
    };

    const title = lines.slice(0, 12).find(isConservativeVacancyTitle);
    const location = lines.slice(0, 16).map(extractLocation).find((value) => value !== null);
    const engagement = lines.map(extractEngagement).find((value) => value !== null);
    const workMode = lines.map(extractWorkMode).find((value) => value !== null);
    const compensation = extractCompensation(vacancyText);

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: title, provenance }] }),
      ...(location === undefined ? {} : { locations: [{ value: location, role: "WORKPLACE", provenance }] }),
      ...(engagement === undefined ? {} : { engagements: [{ ...engagement, provenance }] }),
      ...(workMode === undefined ? {} : { workModes: [{ value: workMode, provenance }] }),
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
  const department = /^(?:\d{2,3}|2[AB])\s*-\s*(.{2,100})$/iu.exec(line);
  if (department !== null) return normalizeLine(department[1] ?? "") || null;
  const frenchLocation = /^([\p{L}][\p{L}\s'’.-]{2,80},\s*France)(?=\s*(?:·|$))/u.exec(line);
  if (frenchLocation !== null) return normalizeLine(frenchLocation[1] ?? "") || null;
  return null;
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
  if (/^hybride$/iu.test(line)) return "HYBRID";
  if (/^(?:t[eé]l[eé]travail|[àa]\s+distance|remote)$/iu.test(line)) return "REMOTE";
  return null;
}

type ExtractedCompensation = Pick<
  VacancyCompensationEvidence,
  "rawText" | "currency" | "minimum" | "maximum" | "period"
>;

function extractCompensation(text: string): ExtractedCompensation | null {
  const annual = /\bSalaire\s+brut\s*:\s*Annuel\s+de\s+([\d ]+(?:[.,]\d+)?)\s+Euros?\s+[àa]\s+([\d ]+(?:[.,]\d+)?)\s+Euros?\b/iu.exec(text);
  const compactRange = /\b(\d+(?:[.,]\d+)?)k\s*[–-]\s*(\d+(?:[.,]\d+)?)k\s*€\s*\/?\s*(h|heure|mois|an|ann[eé]e)\b/iu.exec(text);
  const common = compactRange ?? /\b([\d ]+(?:[.,]\d+)?)\s*(?:k)?\s*€\s*(?:[àa\-–]\s*([\d ]+(?:[.,]\d+)?)\s*(k)?\s*€)?\s*\/?\s*(h|heure|mois|an|ann[eé]e)\b/iu.exec(text);
  const match = annual ?? common;
  if (match === null) return null;
  const annualMatch = annual !== null;
  const factor = !annualMatch && /k/iu.test(match[0]) ? 1000 : 1;
  const minimum = Number(match[1]!.replace(/\s/gu, "").replace(",", ".")) * factor;
  const maximum = match[2] === undefined ? undefined : Number(match[2].replace(/\s/gu, "").replace(",", ".")) * factor;
  const unit = annualMatch ? "YEAR" : match[compactRange === null ? 4 : 3]?.toLocaleLowerCase();
  return {
    rawText: normalizeLine(match[0]),
    currency: "EUR",
    minimum,
    ...(maximum === undefined ? {} : { maximum }),
    period: unit === "h" || unit === "heure" ? "HOUR" : unit === "mois" ? "MONTH" : "YEAR",
  };
}
