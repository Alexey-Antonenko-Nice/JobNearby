import type { SourceObservationId } from "../capture/SourceObservation.js";

export type EvidenceExtractionMethod =
  | "DIRECT_FIELD"
  | "TEXT_EXTRACTION"
  | "USER_CONFIRMED"
  | "EXTERNAL_SOURCE";

export type EvidenceContentOrigin =
  | "SOURCE_OBSERVATION"
  | "SELECTED_VACANCY_CONTEXT";

export interface EvidenceProvenance {
  readonly sourceObservationId: SourceObservationId;
  readonly extractionMethod: EvidenceExtractionMethod;
  readonly confidence: number;
  readonly contentOrigin?: EvidenceContentOrigin;
}

const extractionMethods: readonly EvidenceExtractionMethod[] = [
  "DIRECT_FIELD",
  "TEXT_EXTRACTION",
  "USER_CONFIRMED",
  "EXTERNAL_SOURCE",
];

const contentOrigins: readonly EvidenceContentOrigin[] = [
  "SOURCE_OBSERVATION",
  "SELECTED_VACANCY_CONTEXT",
];

export function createEvidenceProvenance(
  provenance: EvidenceProvenance,
): EvidenceProvenance {
  if (provenance.sourceObservationId.trim().length === 0) {
    throw new Error("Evidence source observation ID is required.");
  }

  if (
    !Number.isFinite(provenance.confidence) ||
    provenance.confidence < 0 ||
    provenance.confidence > 1
  ) {
    throw new Error("Evidence extraction confidence must be between 0 and 1.");
  }

  if (!extractionMethods.includes(provenance.extractionMethod)) {
    throw new Error("Evidence extraction method is invalid.");
  }
  if (
    provenance.contentOrigin !== undefined &&
    !contentOrigins.includes(provenance.contentOrigin)
  ) {
    throw new Error("Evidence content origin is invalid.");
  }

  return {
    sourceObservationId: provenance.sourceObservationId.trim(),
    extractionMethod: provenance.extractionMethod,
    confidence: provenance.confidence,
    ...(provenance.contentOrigin === undefined
      ? {}
      : { contentOrigin: provenance.contentOrigin }),
  };
}

export function requireEvidenceText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}
