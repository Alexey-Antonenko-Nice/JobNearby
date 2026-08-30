import type {
  EmployerCharacteristicCategory,
  EmployerCharacteristicEvidence,
  EvidenceSpecificity,
} from "../../domain/evidence/EmployerCharacteristicEvidence.js";
import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import {
  normalizeVacancyEvidenceInput,
  textualEvidenceContent,
  type VacancyEvidenceExtractionInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";

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
    pattern:
      /\b(?:pharmaceutical\s+(?:manufacturing\s+(?:organization|organisation|site)|industrial\s+site|production\s+environment)|regulated\s+pharmaceutical\s+production\s+environment|site\s+industriel\s+pharmaceutique|environnement\s+de\s+production\s+pharmaceutique|industrie\s+pharmaceutique)\b/giu,
    category: "INDUSTRY",
    specificity: "HIGH",
    canonicalValue: "pharmaceutical manufacturing",
    requiresEmployerContext: true,
  },
  {
    pattern:
      /\b(?:lifting[- ]equipment\s+(?:company|business|activity)|(?:company|business)\s+(?:specializing|operating|specializes|operates)\s+in\s+lifting[- ]equipment(?:\s+activity)?|activit[eé]\s+li[eé]e\s+aux?\s+(?:appareils?|mat[eé]riels?)\s+de\s+levage|entreprise\s+(?:est\s+)?sp[eé]cialis[eé]e\s+dans\s+(?:les?\s+)?(?:appareils?|mat[eé]riels?)\s+de\s+levage)\b/giu,
    category: "PRODUCT",
    specificity: "HIGH",
    canonicalValue: "lifting-equipment business",
    requiresEmployerContext: true,
  },
  {
    pattern:
      /\b(?:industrial\s+production\s+site|manufacturing\s+production\s+site|production\s+facility|site\s+(?:industriel\s+)?de\s+production(?:\s+industrielle)?|usine\s+de\s+production)\b/giu,
    category: "INFRASTRUCTURE",
    specificity: "MEDIUM",
    canonicalValue: "industrial production site",
    requiresEmployerContext: true,
  },
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
    input: VacancyEvidenceExtractionInput,
  ): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const { vacancyText: text, contentOrigin } = textualEvidenceContent(input);
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: EXPLICIT_CHARACTERISTIC_CONFIDENCE,
      ...(contentOrigin === undefined ? {} : { contentOrigin }),
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

  return /\b(?:required|preferred|experience|qualification|candidate|your\s+(?:responsibilities|duties)|you\s+(?:have|are|will)|must|bac\s*\+?\s*\d|autonomous|proficien(?:t|cy)|knowledge\s+of|exp[eé]rience|requis(?:e)?|exig[eé]e?|souhait[eé]e?|candidat(?:e)?|vous|vos\s+missions|missions?|comp[eé]tences?|ma[iî]trise|connaissance|autonome|charg[eé]e?\s+de)\b/iu.test(
    sentence,
  );
}

function isEmployerAttributedContext(text: string, matchIndex: number): boolean {
  return /\b(?:client|company|business|group|employer|site|facility|factory|environment|organisation|organization|entreprise|soci[eé]t[eé]|groupe|employeur|usine|environnement)\b/iu.test(
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
