import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { createExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { LocationEvidence } from "../../domain/evidence/LocationEvidence.js";
import {
  normalizeOrganizationEvidenceName,
  type OrganizationEvidence,
  type OrganizationEvidenceRole,
} from "../../domain/evidence/OrganizationEvidence.js";
import type { PersonEvidence } from "../../domain/evidence/PersonEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import { isConservativeVacancyTitle } from "./CoreVacancyHeaderFactsExtractor.js";
import {
  normalizeVacancyEvidenceInput,
  textualEvidenceContent,
  type VacancyEvidenceExtractionInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";

const EXPLICIT_TEXT_CONFIDENCE = 0.98;

export class ExplicitTextVacancyEvidenceExtractor
  implements VacancyEvidenceExtractor
{
  async extract(
    input: VacancyEvidenceExtractionInput,
  ): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const { vacancyText, contactText, contentOrigin } = textualEvidenceContent(input);
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "TEXT_EXTRACTION" as const,
      confidence: EXPLICIT_TEXT_CONFIDENCE,
      ...(contentOrigin === undefined ? {} : { contentOrigin }),
    };

    const organizations: OrganizationEvidence[] = [];
    for (const value of extractExplicitEmployerNames(vacancyText)) {
      organizations.push({ value, role: "EMPLOYER", provenance });
    }

    organizations.push(
      ...extractBoundedOrganizationRoles(vacancyText).map(
        ({ value, role }) => ({
          value,
          normalizedName: normalizeOrganizationEvidenceName(value),
          role,
          provenance,
        }),
      ),
    );

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

interface ExtractedOrganizationRole {
  readonly value: string;
  readonly role: OrganizationEvidenceRole;
}

function extractBoundedOrganizationRoles(
  text: string,
): ExtractedOrganizationRole[] {
  const results: ExtractedOrganizationRole[] = [];
  const lines = text.split(/\r?\n/u).map(normalizeCapturedValue).filter(Boolean);

  const roleLabels: Readonly<Record<string, OrganizationEvidenceRole>> = {
    employeur: "EMPLOYER",
    recruteur: "RECRUITER",
    client: "CLIENT",
    "client final": "CLIENT",
    "end customer": "CLIENT",
  };
  for (let index = 0; index < lines.length - 1; index += 1) {
    const label = lines[index]!.replace(/\s*:\s*$/u, "").toLocaleLowerCase();
    const role = roleLabels[label];
    if (role !== undefined) addOrganizationRole(results, lines[index + 1]!, role);
  }

  for (const match of text.matchAll(
    /(?:^|\n)\s*(Employeur|Recruteur|Client(?:\s+final)?|End\s+customer)\s*:\s*([^\n,;:!?]{2,80})/giu,
  )) {
    const role = roleLabels[(match[1] ?? "").toLocaleLowerCase()];
    if (role !== undefined) addOrganizationRole(results, match[2] ?? "", role);
  }

  if (
    lines.length >= 2 &&
    !isConservativeVacancyTitle(lines[0]!) &&
    looksLikeExplicitOrganizationName(lines[0]!) &&
    /\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m)\b/iu.test(lines[1]!)
  ) {
    addOrganizationRole(results, lines[0]!, "UNKNOWN");
  }

  for (const match of text.matchAll(
    /\bnotre\s+agence\s+([\p{L}\d][\p{L}\d&'’().\-\s]{1,60}?)\s+(?:recherche|recrute)\b/giu,
  )) {
    addOrganizationRole(results, match[1] ?? "", "RECRUITER");
  }
  for (const match of text.matchAll(
    /(?:^|[.!?\n])\s*([\p{Lu}][\p{L}\d&'’().\-]*(?:\s+[\p{Lu}][\p{L}\d&'’().\-]*){0,4})\s+(?:recherche|recrute)\b/gu,
  )) {
    addOrganizationRole(results, match[1] ?? "", "RECRUITER");
  }
  for (const match of text.matchAll(
    /\bConsulting\s*&\s*Solutions\s+d['’]([\p{Lu}][\p{L}\d&'’().\-]*(?:\s+[\p{Lu}][\p{L}\d&'’().\-]*){0,4})\b/gu,
  )) {
    addOrganizationRole(results, match[1] ?? "", "CONSULTANCY");
  }
  for (const match of text.matchAll(
    /(?:^|[.!?\n])\s*([\p{Lu}][\p{L}\d&'’().\-]*(?:\s+[\p{Lu}][\p{L}\d&'’().\-]*){0,4})\s+(?:accompagne|aide)\s+(?:les\s+)?entreprises\b[^.!?\n]{0,140}\b(?:experts?|ing[eé]nieurs?)\b/gu,
  )) {
    addOrganizationRole(results, match[1] ?? "", "CONSULTANCY");
  }

  return uniqueByRoleAndValue(results);
}

function addOrganizationRole(
  results: ExtractedOrganizationRole[],
  rawValue: string,
  role: OrganizationEvidenceRole,
): void {
  const value = normalizeCapturedValue(rawValue);
  if (
    value.length > 0 &&
    looksLikeExplicitOrganizationName(value) &&
    !/^(?:entreprise|client|groupe|agence|employeur)$/iu.test(value)
  ) {
    results.push({ value, role });
  }
}

function classifyDisplayedIntermediary(
  text: string,
  displayedCompanyName: string | undefined,
  sourceName: string,
): "RECRUITMENT_AGENCY" | "STAFFING_AGENCY" | null {
  if (displayedCompanyName === undefined) {
    return null;
  }

  const escapedDisplayedName = escapeRegExp(displayedCompanyName.trim());
  if (
    new RegExp(
      `${escapedDisplayedName}\\s+is\\s+an?\\s+employment\\s+agency\\b`,
      "iu",
    ).test(text)
  ) {
    return "STAFFING_AGENCY";
  }

  if (
    normalizeForComparison(displayedCompanyName) === normalizeForComparison(sourceName)
  ) {
    return null;
  }

  const nameRanges = findRanges(
    text,
    new RegExp(escapedDisplayedName, "giu"),
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
    const normalizedName = "normalizedName" in item &&
        typeof item.normalizedName === "string"
      ? item.normalizedName
      : normalizeOrganizationEvidenceName(item.value);
    const key = `${item.role}\u0000${normalizedName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
