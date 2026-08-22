import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type {
  EmployerCharacteristicCategory,
  EmployerCharacteristicEvidence,
  EvidenceSpecificity,
} from "../../domain/evidence/EmployerCharacteristicEvidence.js";
import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";

const EXPLICIT_CHARACTERISTIC_CONFIDENCE = 0.98;

interface CharacteristicRule {
  readonly pattern: RegExp;
  readonly category: EmployerCharacteristicCategory;
  readonly specificity: EvidenceSpecificity;
}

const rules: readonly CharacteristicRule[] = [
  {
    pattern: /\bindependent\s+Alsatian\s+SME\b/giu,
    category: "ORGANIZATION",
    specificity: "HIGH",
  },
  {
    pattern: /\bfounded\s+in\s+\d{4}\b/giu,
    category: "DISTINCTIVE_FACT",
    specificity: "HIGH",
  },
  {
    pattern: /\bend[- ]of[- ]line\s+packaging\s+equipment\b/giu,
    category: "PRODUCT",
    specificity: "HIGH",
  },
  {
    pattern: /\bROBOPAC\s+distributor\b/giu,
    category: "DISTINCTIVE_FACT",
    specificity: "VERY_HIGH",
  },
  {
    pattern: /\b\d{1,3}(?:[ ,.']\d{3})*\s+sites\b/giu,
    category: "ORGANIZATION",
    specificity: "HIGH",
  },
  {
    pattern: /\b\d{1,3}(?:[ ,.']\d{3})*\s+employees\b/giu,
    category: "COMPANY_SIZE",
    specificity: "HIGH",
  },
  {
    pattern: /\bconcrete\s+manufacturing\b/giu,
    category: "INDUSTRY",
    specificity: "MEDIUM",
  },
  {
    pattern: /\brailway\s+rolling[- ]stock\s+manufacturing\b/giu,
    category: "INDUSTRY",
    specificity: "HIGH",
  },
];

export class ExplicitEmployerCharacteristicExtractor
  implements VacancyEvidenceExtractor
{
  async extract(
    observation: SourceObservation,
  ): Promise<ExtractedVacancyEvidence> {
    const text = [observation.description, observation.rawContent]
      .filter((value): value is string => value !== undefined)
      .join("\n");
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: EXPLICIT_CHARACTERISTIC_CONFIDENCE,
    };
    const employerCharacteristics: EmployerCharacteristicEvidence[] = [];

    for (const rule of rules) {
      for (const match of text.matchAll(rule.pattern)) {
        if (!isCandidateRequirementContext(text, match.index)) {
          employerCharacteristics.push({
            value: normalizeValue(match[0]),
            category: rule.category,
            specificity: rule.specificity,
            provenance,
          });
        }
      }
    }

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      employerCharacteristics: uniqueCharacteristics(employerCharacteristics),
    });
  }
}

function isCandidateRequirementContext(text: string, matchIndex: number): boolean {
  const sentenceStart = Math.max(
    text.lastIndexOf(".", matchIndex - 1),
    text.lastIndexOf("!", matchIndex - 1),
    text.lastIndexOf("?", matchIndex - 1),
    text.lastIndexOf("\n", matchIndex - 1),
  );
  const followingBoundaries = [".", "!", "?", "\n"]
    .map((boundary) => text.indexOf(boundary, matchIndex))
    .filter((index) => index >= 0);
  const sentenceEnd =
    followingBoundaries.length === 0
      ? text.length
      : Math.min(...followingBoundaries);
  const sentence = text.slice(sentenceStart + 1, sentenceEnd);

  return /\b(?:required|preferred|experience|qualification|candidate|you\s+(?:have|are)|must|bac\s*\+?\s*\d|autonomous|proficien(?:t|cy)|knowledge\s+of)\b/iu.test(
    sentence,
  );
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function uniqueCharacteristics(
  characteristics: readonly EmployerCharacteristicEvidence[],
): EmployerCharacteristicEvidence[] {
  const seen = new Set<string>();
  return characteristics.filter((characteristic) => {
    const key = `${characteristic.category}\u0000${characteristic.value.toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
