import {
  createCanonicalDerivationMetadata,
  createCanonicalField,
  type CanonicalField,
} from "./CanonicalField.js";
import type {
  CanonicalVacancy,
  VacancyOrganizationRelationship,
  VacancyOrganizationRole,
} from "./CanonicalVacancy.js";

const organizationRoles: readonly VacancyOrganizationRole[] = [
  "DISPLAYED_COMPANY",
  "EMPLOYER",
  "RECRUITER",
  "STAFFING_AGENCY",
  "CONSULTANCY",
  "CLIENT",
  "PROJECT_CUSTOMER",
  "UNKNOWN",
];

export function validateCanonicalVacancy(
  vacancy: CanonicalVacancy,
): CanonicalVacancy {
  const id = requireText(vacancy.id, "Canonical vacancy ID");
  const sourceObservationIds = uniqueRequired(vacancy.sourceObservationIds);
  if (sourceObservationIds.length === 0) {
    throw new Error("Canonical vacancy requires source observations.");
  }
  const sourceIds = new Set(sourceObservationIds);
  const evidenceIds = new Set<string>();
  const evidenceReferences = vacancy.evidenceReferences.map((reference) => {
    const evidenceId = requireText(reference.id, "Canonical evidence reference ID");
    if (evidenceIds.has(evidenceId)) {
      throw new Error(`Duplicate canonical evidence reference "${evidenceId}".`);
    }
    if (!sourceIds.has(reference.sourceObservationId)) {
      throw new Error("Canonical evidence reference points outside vacancy observations.");
    }
    evidenceIds.add(evidenceId);
    return {
      id: evidenceId,
      sourceObservationId: reference.sourceObservationId,
      kind: requireText(reference.kind, "Canonical evidence reference kind"),
    };
  });

  const fields = {
    role: validateField(vacancy.role, evidenceIds),
    publicationLanguages: validateField(vacancy.publicationLanguages, evidenceIds),
    location: validateField(vacancy.location, evidenceIds),
    workMode: validateField(vacancy.workMode, evidenceIds),
    remoteEligibleCountries: validateField(vacancy.remoteEligibleCountries, evidenceIds),
    travel: validateField(vacancy.travel, evidenceIds),
    engagement: validateField(vacancy.engagement, evidenceIds),
    compensation: validateField(vacancy.compensation, evidenceIds),
    experienceRequirements: validateField(vacancy.experienceRequirements, evidenceIds),
    educationRequirements: validateField(vacancy.educationRequirements, evidenceIds),
    skillRequirements: validateField(vacancy.skillRequirements, evidenceIds),
    languageRequirements: validateField(vacancy.languageRequirements, evidenceIds),
    functionalContexts: validateField(vacancy.functionalContexts, evidenceIds),
    industryContexts: validateField(vacancy.industryContexts, evidenceIds),
    positionCount: validateField(vacancy.positionCount, evidenceIds),
    lifecycleStatus: validateField(vacancy.lifecycleStatus, evidenceIds),
  };
  const expectedStatus = Object.values(fields).some(
    ({ status }) => status === "CONFLICTED",
  )
    ? "CONFLICTED"
    : fields.role.status === "RESOLVED"
      ? "USABLE"
      : "PARTIAL";
  if (vacancy.canonicalizationStatus !== expectedStatus) {
    throw new Error("Canonicalization status is inconsistent with canonical fields.");
  }

  return {
    id,
    sourceObservationIds,
    evidenceReferences,
    ...fields,
    organizationRelationships: vacancy.organizationRelationships.map(
      (relationship) => validateRelationship(relationship, evidenceIds),
    ),
    canonicalizationStatus: vacancy.canonicalizationStatus,
    derivation: createCanonicalDerivationMetadata(vacancy.derivation),
  };
}

function validateField<T>(
  field: CanonicalField<T>,
  evidenceIds: ReadonlySet<string>,
): CanonicalField<T> {
  const validated = createCanonicalField(field);
  validateEvidenceIds(validated.supportingEvidenceIds, evidenceIds);
  validateEvidenceIds(validated.conflictingEvidenceIds, evidenceIds);
  for (const alternative of validated.alternatives ?? []) {
    validateEvidenceIds(alternative.supportingEvidenceIds, evidenceIds);
  }
  return validated;
}

function validateRelationship(
  relationship: VacancyOrganizationRelationship,
  evidenceIds: ReadonlySet<string>,
): VacancyOrganizationRelationship {
  if (!organizationRoles.includes(relationship.role)) {
    throw new Error("Stored vacancy organization role is invalid.");
  }
  if (
    [relationship.organizationId, relationship.employerClusterId, relationship.rawName]
      .every((value) => value === undefined || value.trim().length === 0)
  ) {
    throw new Error("Vacancy organization relationship requires an anchor.");
  }
  if (relationship.supportingEvidenceIds.length === 0) {
    throw new Error("Vacancy organization relationship requires supporting evidence.");
  }
  validateEvidenceIds(relationship.supportingEvidenceIds, evidenceIds);
  if (
    relationship.confidence !== undefined &&
    (!Number.isFinite(relationship.confidence) ||
      relationship.confidence < 0 ||
      relationship.confidence > 1)
  ) {
    throw new Error("Vacancy organization confidence must be between 0 and 1.");
  }
  return {
    ...relationship,
    supportingEvidenceIds: [...new Set(relationship.supportingEvidenceIds)],
    derivation: createCanonicalDerivationMetadata(relationship.derivation),
  };
}

function validateEvidenceIds(
  ids: readonly string[],
  evidenceIds: ReadonlySet<string>,
): void {
  if (ids.some((id) => !evidenceIds.has(id))) {
    throw new Error("Canonical field references unknown canonical evidence.");
  }
}

function uniqueRequired(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => requireText(value, "Source observation ID")))];
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required.`);
  return trimmed;
}
