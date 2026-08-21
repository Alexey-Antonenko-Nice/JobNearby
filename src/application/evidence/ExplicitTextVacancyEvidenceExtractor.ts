import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { LocationEvidence } from "../../domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../domain/evidence/OrganizationEvidence.js";
import type { PersonEvidence } from "../../domain/evidence/PersonEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";

const EXPLICIT_TEXT_CONFIDENCE = 0.98;

export class ExplicitTextVacancyEvidenceExtractor
  implements VacancyEvidenceExtractor
{
  async extract(
    observation: SourceObservation,
  ): Promise<ExtractedVacancyEvidence> {
    const vacancyText = [observation.description, observation.rawContent]
      .filter((value): value is string => value !== undefined)
      .join("\n");
    const contactText = observation.contactText ?? "";
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: EXPLICIT_TEXT_CONFIDENCE,
    };

    const organizations: OrganizationEvidence[] = [];
    for (const value of extractExplicitEmployerNames(vacancyText)) {
      organizations.push({ value, role: "EMPLOYER", provenance });
    }

    const intermediaryRole = classifyDisplayedIntermediary(
      vacancyText,
      observation.displayedCompanyName,
      observation.source.sourceName,
    );
    if (
      intermediaryRole !== null &&
      observation.displayedCompanyName !== undefined
    ) {
      organizations.push({
        value: observation.displayedCompanyName,
        role: intermediaryRole,
        provenance,
      });
    }

    const people: PersonEvidence[] = extractNamedRecruiters(
      [vacancyText, contactText].filter((value) => value.length > 0).join("\n"),
    ).map((value) => ({ value, role: "RECRUITER", provenance }));

    const locations: LocationEvidence[] = extractExplicitWorkplaces(
      vacancyText,
    ).map((value) => ({ value, role: "WORKPLACE", provenance }));

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations: uniqueByRoleAndValue(organizations),
      locations: uniqueByRoleAndValue(locations),
      people: uniqueByRoleAndValue(people),
    });
  }
}

function extractExplicitEmployerNames(text: string): string[] {
  const pattern =
    /pour\s+(?:(?:le\s+compte\s+de\s+)?notre\s+client|l['’]un\s+de\s+nos\s+clients?)\s*,?\s+([^\n,;:!?….]{2,80})/giu;
  const names: string[] = [];

  for (const match of text.matchAll(pattern)) {
    const candidate = normalizeCapturedValue(match[1] ?? "");
    if (
      candidate.length > 0 &&
      looksLikeExplicitOrganizationName(candidate) &&
      !/^(?:situ[eé]e?|bas[eé]e?)\s+[àa]\b/iu.test(candidate)
    ) {
      names.push(candidate);
    }
  }

  return [...new Set(names)];
}

function classifyDisplayedIntermediary(
  text: string,
  displayedCompanyName: string | undefined,
  sourceName: string,
): "RECRUITMENT_AGENCY" | "STAFFING_AGENCY" | null {
  if (
    displayedCompanyName === undefined ||
    normalizeForComparison(displayedCompanyName) === normalizeForComparison(sourceName)
  ) {
    return null;
  }

  const nameRanges = findRanges(
    text,
    new RegExp(escapeRegExp(displayedCompanyName.trim()), "giu"),
  );
  const descriptions = [
    ...findRanges(
      text,
      /agence\s+d['’](?:emploi|int[eé]rim)|agence\s+d'interim|travail\s+temporaire/giu,
    ).map((range) => ({ ...range, role: "STAFFING_AGENCY" as const })),
    ...findRanges(
      text,
      /cabinet\s+de\s+recrutement|agence\s+de\s+recrutement/giu,
    ).map((range) => ({ ...range, role: "RECRUITMENT_AGENCY" as const })),
  ];

  const localDescriptions = descriptions
    .map((description) => ({
      ...description,
      distance: Math.min(
        ...nameRanges.map((name) => rangeDistance(name, description)),
      ),
    }))
    .filter(({ distance }) => distance <= 80)
    .sort((left, right) => left.distance - right.distance);

  return localDescriptions[0]?.role ?? null;
}

function looksLikeExplicitOrganizationName(value: string): boolean {
  const words = value.split(/\s+/u);
  const connectorWords = new Set(["de", "du", "des", "la", "le", "et"]);

  return (
    words.length <= 8 &&
    words.some((word) => /^\p{Lu}/u.test(word)) &&
    words.every(
      (word) =>
        connectorWords.has(word.toLocaleLowerCase()) ||
        /^[\p{Lu}\d][\p{L}\d&'’()/-]*$/u.test(word),
    )
  );
}

function extractNamedRecruiters(text: string): string[] {
  const pattern =
    /(?:personne\s+en\s+charge\s+du\s+recrutement|contact\s+recrutement|votre\s+recruteur)\s*:\s*([^\n,;:!?….]{2,80})/giu;
  return [...text.matchAll(pattern)]
    .map((match) => normalizeCapturedValue(match[1] ?? ""))
    .filter((value) => value.length > 0);
}

function extractExplicitWorkplaces(text: string): string[] {
  const pattern =
    /(?:poste\s+(?:est\s+)?(?:bas[eé]|situ[eé])|notre\s+client\s+(?:est\s+)?(?:bas[eé]|situ[eé]))\s+[àa]\s+([^\n,;:!?….]{2,80})/giu;
  return [...text.matchAll(pattern)]
    .map((match) => normalizeCapturedValue(match[1] ?? ""))
    .filter((value) => value.length > 0);
}

function normalizeCapturedValue(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[\s—–-]+|[\s—–.,;:!?…]+$/gu, "")
    .trim();
}

function normalizeForComparison(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

function findRanges(text: string, pattern: RegExp): TextRange[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function rangeDistance(left: TextRange, right: TextRange): number {
  if (left.end < right.start) return right.start - left.end;
  if (right.end < left.start) return left.start - right.end;
  return 0;
}

function uniqueByRoleAndValue<T extends { readonly role: string; readonly value: string }>(
  evidence: readonly T[],
): T[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.role}\u0000${normalizeForComparison(item.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
