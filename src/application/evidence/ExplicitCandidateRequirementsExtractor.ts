import type {
  ExperienceRequirementEvidence,
  LanguageRequirementEvidence,
  TravelRequirementEvidence,
} from "../../domain/evidence/CandidateRequirementEvidence.js";
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

const confidence = 0.98;

export class ExplicitCandidateRequirementsExtractor implements VacancyEvidenceExtractor {
  async extract(input: VacancyEvidenceExtractionInput): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const { vacancyText, contentOrigin } = textualEvidenceContent(input);
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence,
      ...(contentOrigin === undefined ? {} : { contentOrigin }),
    };
    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      languageRequirements: extractLanguages(vacancyText).map((item) => ({ ...item, provenance })),
      experienceRequirements: (observation.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT" && observation.evidenceContent.context.providerKey === "START_PEOPLE" ? [] : extractExperience(vacancyText)).map((item) => ({ ...item, provenance })),
      travelRequirements: extractTravel(vacancyText).map((item) => ({ ...item, provenance })),
    });
  }
}

type LanguageWithoutProvenance = Omit<LanguageRequirementEvidence, "provenance">;
type ExperienceWithoutProvenance = Omit<ExperienceRequirementEvidence, "provenance">;
type TravelWithoutProvenance = Omit<TravelRequirementEvidence, "provenance">;

function extractLanguages(text: string): LanguageWithoutProvenance[] {
  const results: LanguageWithoutProvenance[] = [];
  const patterns = [
    /\b(français|anglais|allemand|french|english|german)\s+(?:(?:niveau\s+)?([abc][12])|courant|professionnel|fluent|required|mandatory|essential|requis|obligatoire|indispensable|souhait[ée]|appr[ée]ci[ée]|preferred|is\s+a\s+plus|serait\s+un\s+plus)\b/giu,
    /\b(?:ma[iî]trise\s+(?:du|de\s+l['’])\s*)(français|anglais|allemand)\b/giu,
    /\b(?:niveau\s+)?([abc][12])\s+(?:en\s+)?(français|anglais|allemand|french|english|german)\b/giu,
    /\b(french|english|german)\s+is\s+a\s+plus\b/giu,
    /\b(?:fluent|professional)\s+(french|english|german)\b/giu,
  ];
  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const languageCapture = patternIndex === 2 ? match[2] : match[1];
      const levelCapture = patternIndex === 2 ? match[1] : match[2];
      if (languageCapture === undefined) continue;
      const rawText = match[0].trim();
      const strength = languageStrength(rawText);
      results.push({
        rawText,
        language: normalizeLanguage(languageCapture),
        requirement: strength === "UNKNOWN" && isProfileStatement(text, match.index ?? 0) ? "REQUIRED" : strength,
        ...(levelCapture === undefined ? {} : { level: levelCapture.toUpperCase() }),
      });
    }
  }
  return unique(results, (item) => normalize(item.rawText));
}

function normalizeLanguage(value: string): string {
  const normalized = normalize(value);
  if (normalized === "français" || normalized === "french") return "French";
  if (normalized === "anglais" || normalized === "english") return "English";
  return "German";
}

function languageStrength(rawText: string): LanguageWithoutProvenance["requirement"] {
  if (/\b(?:required|mandatory|essential|requis|obligatoire|indispensable)\b/iu.test(rawText)) return "REQUIRED";
  if (/\b(?:preferred|souhait[ée]|appr[ée]ci[ée])\b/iu.test(rawText)) return "PREFERRED";
  if (/\b(?:plus)\b/iu.test(rawText)) return "PLUS";
  return "UNKNOWN";
}

const PROFILE_HEADING = /^(?:votre\s+profil|profil\s+recherch[ée]|profil\s+souhait[ée]|vous\s+[êe]tes|your\s+profile|requirements|qualifications|pr[ée]requis|comp[ée]tences\s+requises)\b/iu;
const OTHER_HEADING = /^(?:pourquoi|nous\s+offrons|ce\s+que\s+nous|avantages|vos\s+missions|vos\s+principales|poste\s*\/|missions?\b|description|why\b|what\s+we\s+offer|responsibilities)/iu;
const FIRST_PERSON_PROFILE = /^(?:vous\s+(?:ma[iî]trisez|parlez)|you\s+(?:speak|are\s+fluent))\b/iu;
const SOFT_WORDING = /\b(?:souhait[ée]|serait|appr[ée]ci[ée]|un\s+plus|atout|preferred|nice\s+to\s+have|bonus)\b/iu;

// "Vous maîtrisez l'anglais …" is a requirement only as a direct statement of the
// profile section; hedged wording or other sections keep the strength unknown.
function isProfileStatement(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim();
  if (!FIRST_PERSON_PROFILE.test(line) || SOFT_WORDING.test(line)) return false;
  const previous = text.slice(0, lineStart).split("\n").reverse().slice(0, 20).map((value) => value.trim());
  for (const value of previous) {
    if (PROFILE_HEADING.test(value)) return true;
    if (OTHER_HEADING.test(value)) return false;
  }
  return false;
}

function extractExperience(text: string): ExperienceWithoutProvenance[] {
  const results: ExperienceWithoutProvenance[] = [];
  const rangePatterns = [
    /\b(?:exp[ée]rience\s+de\s+)?(\d+(?:[.,]\d+)?)\s*(?:à|a|-)\s*(\d+(?:[.,]\d+)?)\s+(?:ans?|ann[ée]es?)(?:\s+d['’]exp[ée]rience)?\b/giu,
    /\b(\d+(?:[.,]\d+)?)\s*(?:-|to)\s*(\d+(?:[.,]\d+)?)\s+years?(?:\s+of)?\s+experience\b/giu,
  ];
  for (const pattern of rangePatterns) for (const match of text.matchAll(pattern)) {
    results.push(requirement(match[0], match[1], match[2]));
  }
  const minimumPatterns = [
    /\b(?:(?:minimum|au\s+moins)\s+|vous\s+justifiez\s+de\s+)?(\d+(?:[.,]\d+)?)\s+(?:ans?|ann[ée]es?)\s+d['’]exp[ée]rience\b/giu,
    /\b(\d+(?:[.,]\d+)?)\s+ans\s+minimum\b/giu,
    /\b(?:(?:minimum|at\s+least)\s+)?(\d+(?:[.,]\d+)?)\+?\s+years?(?:\s+of|['’])?\s+experience\b/giu,
  ];
  for (const pattern of minimumPatterns) for (const match of text.matchAll(pattern)) {
    if (isCandidateExperienceContext(text, match.index ?? 0)) {
      results.push(requirement(match[0], match[1]));
    }
  }
  return unique(results, (item) => normalize(item.rawText));
}

function requirement(raw: string, minimum: string | undefined, maximum?: string): ExperienceWithoutProvenance {
  return {
    rawText: raw.trim(),
    minimumYears: number(minimum ?? ""),
    ...(maximum === undefined ? {} : { maximumYears: number(maximum) }),
    unit: "YEAR",
  };
}

function extractTravel(text: string): TravelWithoutProvenance[] {
  const results: TravelWithoutProvenance[] = [];
  const patterns = [
    /\b(?:jusqu['’]à\s+)?(\d{1,3})\s*%\s+(?:de\s+)?d[ée]placements?\b/giu,
    /\b(?:up\s+to\s+)?(\d{1,3})\s*%\s+travel(?:\s+required)?\b/giu,
    /\bd[ée]placements?\s+(?:(?:fr[ée]quents?|r[ée]guliers?|ponctuels?|nationaux(?:\s+et\s+internationaux)?|internationaux)\b|à\s+pr[ée]voir|\d+\s+jours?\s+par\s+semaine)/giu,
    /\bmobilit[ée]\s+(nationale|internationale)\b/giu,
    /\b(?:domestic\s+and\s+international|international\s+and\s+domestic)\s+travel\b/giu,
    /\b(?:(?:frequent|regular|occasional)\s+)?(?:international|domestic)\s+travel(?:\s+required)?\b|\b(?:frequent|regular|occasional)\s+travel(?:\s+required)?\b|\btravel\s+(?:required|may\s+be\s+required)\b/giu,
    /\bwillingness\s+to\s+travel\b/giu,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const rawText = match[0].trim();
    const percentage = rawText.match(/\b(\d{1,3})\s*%/u)?.[1];
    const frequency = travelFrequency(rawText);
    const scope = travelScope(rawText);
    results.push({
      rawText,
      requirement: "REQUIRED",
      ...(frequency === undefined ? {} : { frequency }),
      ...(scope === undefined ? {} : { scope }),
      ...(percentage === undefined ? {} : { percentage: Number(percentage) }),
    });
  }
  return unique(results, (item) => normalize(item.rawText));
}

function travelFrequency(raw: string): TravelWithoutProvenance["frequency"] | undefined {
  if (/\b(?:fr[ée]quents?|frequent)\b/iu.test(raw)) return "FREQUENT";
  if (/\b(?:r[ée]guliers?|regular)\b/iu.test(raw)) return "REGULAR";
  if (/\b(?:ponctuels?|occasional)\b/iu.test(raw)) return "OCCASIONAL";
  return undefined;
}

function travelScope(raw: string): TravelWithoutProvenance["scope"] | undefined {
  if (
    /\b(?:nationaux|nationale|domestic)\b/iu.test(raw) &&
    /\b(?:internationaux|internationale|international)\b/iu.test(raw)
  ) return "BOTH";
  if (/\b(?:internationaux|internationale|international)\b/iu.test(raw)) return "INTERNATIONAL";
  if (/\b(?:nationaux|nationale|domestic)\b/iu.test(raw)) return "DOMESTIC";
  return undefined;
}

function number(value: string): number {
  return Number(value.replace(",", "."));
}

function isCandidateExperienceContext(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 100), matchIndex);
  return !/(?:\b(?:company|enterprise|entreprise|group|groupe|business|soci[ée]t[ée]|we|nous)\b[^.!?\n]{0,70}|\b(?:over|more\s+than|plus\s+de|with|avec)\s*)$/iu.test(prefix);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = key(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
