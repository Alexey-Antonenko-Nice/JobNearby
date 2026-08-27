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
  readonly canonicalValue?: string;
  readonly requiresEmployerContext?: boolean;
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
  {
    pattern:
      /\b(?:family[- ]owned(?:\s+independent)?\s+company|independent\s+family(?:[- ]owned)?\s+(?:company|industrial\s+business)|entreprise\s+(?:familiale\s+ind[eé]pendante|ind[eé]pendante\s+familiale))\b/giu,
    category: "ORGANIZATION",
    specificity: "HIGH",
    canonicalValue: "independent family-owned company",
  },
  {
    pattern:
      /\b(?:(?:more\s+than|over)\s+400\s+(?:employees|people)|plus\s+de\s+400\s+salari[eé]s)\b/giu,
    category: "COMPANY_SIZE",
    specificity: "HIGH",
    canonicalValue: "more than 400 employees",
    requiresEmployerContext: true,
  },
  {
    pattern: /\b(?:wood|bois)\b/giu,
    category: "INDUSTRY",
    specificity: "MEDIUM",
    canonicalValue: "wood activities",
    requiresEmployerContext: true,
  },
  {
    pattern: /(?<![\p{L}\p{N}])(?:energy|[eé]nergie)(?![\p{L}\p{N}])/giu,
    category: "INDUSTRY",
    specificity: "MEDIUM",
    canonicalValue: "energy activities",
    requiresEmployerContext: true,
  },
  {
    pattern: /\b(?:heavy\s+industry|industrie\s+lourde)\b/giu,
    category: "INDUSTRY",
    specificity: "MEDIUM",
    canonicalValue: "heavy industry",
    requiresEmployerContext: true,
  },
  {
    pattern:
      /\b(?:high[- ]precision\s+machining|precision[- ]machining|usinage\s+(?:de\s+)?(?:haute\s+)?pr[eé]cision)\b/giu,
    category: "PROCESS",
    specificity: "HIGH",
    canonicalValue: "precision machining",
  },
  {
    pattern:
      /\b(?:small\s+precision\s+parts|small[- ]size\s+parts|pi[eè]ces\s+de\s+petite\s+taille)\b/giu,
    category: "PRODUCT",
    specificity: "HIGH",
    canonicalValue: "small precision parts",
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
        if (
          !isCandidateRequirementContext(text, match.index) &&
          (!rule.requiresEmployerContext ||
            isEmployerAttributedContext(text, match.index))
        ) {
          employerCharacteristics.push({
            value: rule.canonicalValue ?? normalizeValue(match[0]),
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
  const sentence = sentenceAt(text, matchIndex);

  return /\b(?:required|preferred|experience|qualification|candidate|you\s+(?:have|are)|must|bac\s*\+?\s*\d|autonomous|proficien(?:t|cy)|knowledge\s+of|exp[eé]rience|requis(?:e)?|exig[eé]e?|souhait[eé]e?|candidat(?:e)?|vous|comp[eé]tences?|ma[iî]trise|connaissance|autonome)\b/iu.test(
    sentence,
  );
}

function isEmployerAttributedContext(text: string, matchIndex: number): boolean {
  return /\b(?:client|company|business|group|employer|entreprise|soci[eé]t[eé]|groupe|employeur)\b/iu.test(
    sentenceAt(text, matchIndex),
  );
}

function sentenceAt(text: string, matchIndex: number): string {
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
  return sentence;
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
