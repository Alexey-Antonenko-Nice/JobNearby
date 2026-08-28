import type { CanonicalEvidenceReference } from "../../domain/vacancies/CanonicalEvidenceReference.js";
import {
  createCanonicalDerivationMetadata,
  createCanonicalField,
  type CanonicalDerivationMetadata,
  type CanonicalField,
} from "../../domain/vacancies/CanonicalField.js";
import type {
  CanonicalVacancy,
  VacancyOrganizationRelationship,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type {
  CanonicalCandidate,
  CanonicalizeVacancyInput,
  CanonicalVacancyCanonicalizer,
} from "./CanonicalVacancyCanonicalizer.js";

export class DeterministicCanonicalVacancyCanonicalizer
  implements CanonicalVacancyCanonicalizer
{
  canonicalize(input: CanonicalizeVacancyInput): CanonicalVacancy {
    const id = requireText(input.id, "Canonical vacancy ID");
    const sourceObservationIds = uniqueRequired(
      input.sourceObservationIds,
      "source observation ID",
    );
    if (sourceObservationIds.length === 0) {
      throw new Error("Canonical vacancy requires at least one source observation.");
    }
    const derivation = createCanonicalDerivationMetadata(input.derivation);
    const evidenceIds = validateEvidenceReferences(
      input.evidenceReferences,
      new Set(sourceObservationIds),
    );
    const resolve = <T>(candidates: readonly CanonicalCandidate<T>[] = []) =>
      resolveCanonicalField(candidates, evidenceIds, derivation);
    const organizationRelationships = (input.organizationRelationships ?? []).map(
      (relationship) =>
        validateOrganizationRelationship(relationship, evidenceIds),
    );

    const fields = {
      role: resolve(input.roleCandidates),
      publicationLanguages: resolve(input.publicationLanguageCandidates),
      location: resolve(input.locationCandidates),
      workMode: resolve(input.workModeCandidates),
      remoteEligibleCountries: resolve(input.remoteEligibleCountryCandidates),
      travel: resolve(input.travelCandidates),
      engagement: resolve(input.engagementCandidates),
      compensation: resolve(input.compensationCandidates),
      experienceRequirements: resolve(input.experienceCandidates),
      educationRequirements: resolve(input.educationCandidates),
      skillRequirements: resolve(input.skillCandidates),
      languageRequirements: resolve(input.languageRequirementCandidates),
      functionalContexts: resolve(input.functionalContextCandidates),
      industryContexts: resolve(input.industryContextCandidates),
      positionCount: resolve(input.positionCountCandidates),
      lifecycleStatus: resolve(input.lifecycleCandidates),
    };

    return {
      id,
      sourceObservationIds,
      evidenceReferences: input.evidenceReferences.map((reference) => ({
        ...reference,
      })),
      ...fields,
      organizationRelationships,
      canonicalizationStatus: Object.values(fields).some(
        ({ status }) => status === "CONFLICTED",
      )
        ? "CONFLICTED"
        : fields.role.status === "RESOLVED"
          ? "USABLE"
          : "PARTIAL",
      derivation,
    };
  }
}

export function resolveCanonicalField<T>(
  candidates: readonly CanonicalCandidate<T>[],
  validEvidenceIds: ReadonlySet<string>,
  derivation: CanonicalDerivationMetadata,
): CanonicalField<T> {
  if (candidates.length === 0) {
    return createCanonicalField({
      status: "UNKNOWN",
      supportingEvidenceIds: [],
      conflictingEvidenceIds: [],
      derivation,
    });
  }
  const groups = new Map<string, CanonicalCandidate<T>[]>();
  for (const candidate of candidates) {
    validateEvidenceIds(candidate.supportingEvidenceIds, validEvidenceIds);
    validateConfidence(candidate.confidence);
    const key = stableValue(candidate.value);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const allEvidenceIds = unique(
    candidates.flatMap(({ supportingEvidenceIds }) => supportingEvidenceIds),
  );
  if (groups.size === 1) {
    const confidence = commonConfidence(candidates);
    return createCanonicalField({
      status: "RESOLVED",
      value: candidates[0]!.value,
      supportingEvidenceIds: allEvidenceIds,
      conflictingEvidenceIds: [],
      ...(confidence === undefined ? {} : { confidence }),
      derivation,
    });
  }
  return createCanonicalField({
    status: "CONFLICTED",
    alternatives: [...groups.values()].map((group) => {
      const confidence = commonConfidence(group);
      return {
        value: group[0]!.value,
        supportingEvidenceIds: unique(
          group.flatMap(({ supportingEvidenceIds }) => supportingEvidenceIds),
        ),
        ...(confidence === undefined ? {} : { confidence }),
      };
    }),
    supportingEvidenceIds: allEvidenceIds,
    conflictingEvidenceIds: allEvidenceIds,
    derivation,
  });
}

function commonConfidence<T>(
  candidates: readonly CanonicalCandidate<T>[],
): number | undefined {
  const values = new Set(candidates.map(({ confidence }) => confidence));
  return values.size === 1 ? candidates[0]?.confidence : undefined;
}

function validateEvidenceReferences(
  references: readonly CanonicalEvidenceReference[],
  sourceObservationIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const reference of references) {
    const id = requireText(reference.id, "Canonical evidence reference ID");
    requireText(reference.kind, "Canonical evidence reference kind");
    if (!sourceObservationIds.has(reference.sourceObservationId)) {
      throw new Error("Canonical evidence must trace to a supplied source observation.");
    }
    if (ids.has(id)) throw new Error(`Duplicate canonical evidence reference "${id}".`);
    ids.add(id);
  }
  return ids;
}

function validateOrganizationRelationship(
  relationship: VacancyOrganizationRelationship,
  validEvidenceIds: ReadonlySet<string>,
): VacancyOrganizationRelationship {
  if (
    [relationship.organizationId, relationship.employerClusterId, relationship.rawName]
      .every((anchor) => anchor === undefined || anchor.trim().length === 0)
  ) {
    throw new Error("Vacancy organization relationship requires an organization anchor.");
  }
  validateEvidenceIds(relationship.supportingEvidenceIds, validEvidenceIds);
  if (relationship.supportingEvidenceIds.length === 0) {
    throw new Error("Vacancy organization relationship requires supporting evidence.");
  }
  validateConfidence(relationship.confidence);
  return {
    ...relationship,
    supportingEvidenceIds: unique(relationship.supportingEvidenceIds),
    derivation: createCanonicalDerivationMetadata(relationship.derivation),
  };
}

function validateEvidenceIds(
  ids: readonly string[],
  validEvidenceIds: ReadonlySet<string>,
): void {
  if (ids.length === 0 || ids.some((id) => !validEvidenceIds.has(id))) {
    throw new Error("Every canonical candidate must reference supplied evidence.");
  }
}

function validateConfidence(confidence: number | undefined): void {
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error("Canonical confidence must be between 0 and 1.");
  }
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueRequired(values: readonly string[], label: string): string[] {
  return unique(values.map((value) => requireText(value, label)));
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required.`);
  return trimmed;
}
