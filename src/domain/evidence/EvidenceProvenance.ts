import type { SourceObservationId } from "../capture/SourceObservation.js";

export type EvidenceExtractionMethod =
  | "DIRECT_FIELD"
  | "TEXT_EXTRACTION"
  | "USER_CONFIRMED"
  | "EXTERNAL_SOURCE";

export interface EvidenceProvenance {
  readonly sourceObservationId: SourceObservationId;
  readonly extractionMethod: EvidenceExtractionMethod;
  readonly confidence: number;
}

const extractionMethods: readonly EvidenceExtractionMethod[] = [
  "DIRECT_FIELD",
  "TEXT_EXTRACTION",
  "USER_CONFIRMED",
  "EXTERNAL_SOURCE",
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

  return {
    sourceObservationId: provenance.sourceObservationId.trim(),
    extractionMethod: provenance.extractionMethod,
    confidence: provenance.confidence,
  };
}

export function requireEvidenceText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}
