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

    const title = lines.slice(0, 12).find(isConservativeTitle);
    const location = lines.slice(0, 16).map(extractLocation).find((value) => value !== null);
    const engagement = lines.map(extractEngagement).find((value) => value !== null);
    const workMode = lines.map(extractWorkMode).find((value) => value !== null);
    const compensation = lines.map(extractCompensation).find((value) => value !== null);

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      ...(title === undefined ? {} : { vacancyTitles: [{ value: title, provenance }] }),
      ...(location === undefined ? {} : { locations: [{ value: location, role: "WORKPLACE", provenance }] }),
      ...(engagement === undefined ? {} : { engagements: [{ ...engagement, provenance }] }),
      ...(workMode === undefined ? {} : { workModes: [{ value: workMode, provenance }] }),
      ...(compensation === undefined ? {} : { compensations: [{ ...compensation, provenance }] }),
    });
  }
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isConservativeTitle(line: string): boolean {
  return line.length >= 5 && line.length <= 160 && !SECTION_HEADING.test(line) && TITLE_MARKER.test(line);
}

function extractLocation(line: string): string | null {
  const department = /^(?:\d{2,3}|2[AB])\s*-\s*(.{2,100})$/iu.exec(line);
  if (department !== null) return normalizeLine(department[1] ?? "") || null;
  if (/^[\p{L}][\p{L}\s'’.-]{2,80},\s*France$/u.test(line)) return line;
  return null;
}

function extractEngagement(line: string): Omit<VacancyEngagementEvidence, "provenance"> | null {
  const match = /^(CDI|CDD)$/iu.exec(line);
  if (match === null) return null;
  const raw = match[1]!.toLocaleUpperCase();
  return { rawTerms: [raw], normalizedTerms: [raw === "CDI" ? "INDEFINITE" : "FIXED_TERM"] };
}

function extractWorkMode(line: string): VacancyWorkModeEvidence["value"] | null {
  if (/^hybride$/iu.test(line)) return "HYBRID";
  if (/^(?:t[eé]l[eé]travail|[àa]\s+distance|remote)$/iu.test(line)) return "REMOTE";
  return null;
}

function extractCompensation(line: string): Omit<VacancyCompensationEvidence, "provenance"> | null {
  const match = /^Salaire\s+brut\s*:\s*Annuel\s+de\s+(\d+(?:[.,]\d+)?)\s+Euros?\s+[àa]\s+(\d+(?:[.,]\d+)?)\s+Euros?$/iu.exec(line);
  if (match === null) return null;
  return {
    rawText: line,
    currency: "EUR",
    minimum: Number(match[1]!.replace(",", ".")),
    maximum: Number(match[2]!.replace(",", ".")),
    period: "YEAR",
  };
}
