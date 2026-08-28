import type { CanonicalEvidenceRefId } from "./CanonicalEvidenceReference.js";

export type CanonicalFieldStatus =
  | "RESOLVED"
  | "PARTIAL"
  | "AMBIGUOUS"
  | "CONFLICTED"
  | "UNKNOWN";

export interface CanonicalDerivationMetadata {
  readonly algorithm: string;
  readonly algorithmVersion: string;
  readonly derivedAt: Date;
}

export interface CanonicalAlternative<T> {
  readonly value: T;
  readonly supportingEvidenceIds: readonly CanonicalEvidenceRefId[];
  readonly confidence?: number;
}

export interface CanonicalField<T> {
  readonly status: CanonicalFieldStatus;
  readonly value?: T;
  readonly alternatives?: readonly CanonicalAlternative<T>[];
  readonly supportingEvidenceIds: readonly CanonicalEvidenceRefId[];
  readonly conflictingEvidenceIds: readonly CanonicalEvidenceRefId[];
  readonly confidence?: number;
  readonly derivation: CanonicalDerivationMetadata;
}

export function createCanonicalDerivationMetadata(
  input: CanonicalDerivationMetadata,
): CanonicalDerivationMetadata {
  if (input.algorithm.trim().length === 0 || input.algorithmVersion.trim().length === 0) {
    throw new Error("Canonical derivation algorithm and version are required.");
  }
  if (Number.isNaN(input.derivedAt.getTime())) {
    throw new Error("Canonical derivation timestamp must be valid.");
  }
  return {
    algorithm: input.algorithm.trim(),
    algorithmVersion: input.algorithmVersion.trim(),
    derivedAt: new Date(input.derivedAt),
  };
}

export function createCanonicalField<T>(field: CanonicalField<T>): CanonicalField<T> {
  const validStatuses: readonly CanonicalFieldStatus[] = [
    "RESOLVED",
    "PARTIAL",
    "AMBIGUOUS",
    "CONFLICTED",
    "UNKNOWN",
  ];
  if (!validStatuses.includes(field.status)) {
    throw new Error("Canonical field status is invalid.");
  }
  validateConfidence(field.confidence);
  const alternatives = field.alternatives ?? [];
  for (const alternative of alternatives) {
    if (alternative.supportingEvidenceIds.length === 0) {
      throw new Error("Every canonical alternative requires supporting evidence.");
    }
    validateConfidence(alternative.confidence);
  }
  if (
    field.status === "UNKNOWN" &&
    (field.value !== undefined ||
      alternatives.length > 0 ||
      field.supportingEvidenceIds.length > 0 ||
      field.conflictingEvidenceIds.length > 0)
  ) {
    throw new Error("An unknown canonical field cannot contain values or evidence references.");
  }
  if (field.status !== "UNKNOWN" && field.supportingEvidenceIds.length === 0) {
    throw new Error("Every known canonical field requires supporting evidence.");
  }
  if (field.status === "RESOLVED" && field.value === undefined) {
    throw new Error("A resolved canonical field requires a value.");
  }
  if (field.status === "CONFLICTED" && alternatives.length < 2) {
    throw new Error("A conflicted canonical field requires incompatible alternatives.");
  }
  if (field.status === "CONFLICTED" && field.conflictingEvidenceIds.length === 0) {
    throw new Error("A conflicted canonical field requires conflicting evidence.");
  }
  return {
    ...field,
    supportingEvidenceIds: uniqueNonEmpty(field.supportingEvidenceIds),
    conflictingEvidenceIds: uniqueNonEmpty(field.conflictingEvidenceIds),
    ...(alternatives.length === 0
      ? {}
      : {
          alternatives: alternatives.map((alternative) => ({
            ...alternative,
            supportingEvidenceIds: uniqueNonEmpty(alternative.supportingEvidenceIds),
          })),
        }),
    derivation: createCanonicalDerivationMetadata(field.derivation),
  };
}

function validateConfidence(confidence: number | undefined): void {
  if (
    confidence !== undefined &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    throw new Error("Canonical confidence must be between 0 and 1.");
  }
}

function uniqueNonEmpty(ids: readonly string[]): string[] {
  const normalized = ids.map((id) => id.trim());
  if (normalized.some((id) => id.length === 0)) {
    throw new Error("Canonical evidence reference IDs must be non-empty.");
  }
  return [...new Set(normalized)];
}
