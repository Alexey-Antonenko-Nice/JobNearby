import type { SourceObservationId } from "../../domain/capture/SourceObservation.js";
import type { CanonicalEvidenceReference, CanonicalEvidenceRefId } from "../../domain/vacancies/CanonicalEvidenceReference.js";
import type { CanonicalDerivationMetadata } from "../../domain/vacancies/CanonicalField.js";
import type {
  CanonicalVacancy,
  CanonicalVacancyId,
  EducationRequirement,
  ExperienceRequirement,
  FunctionalContext,
  IndustryContext,
  PublicationLanguage,
  SkillRequirement,
  VacancyCompensation,
  VacancyEngagement,
  VacancyLanguageRequirement,
  VacancyLifecycleStatus,
  VacancyLocation,
  VacancyOrganizationRelationship,
  VacancyPositionCount,
  VacancyRole,
  VacancyTravel,
  VacancyWorkMode,
} from "../../domain/vacancies/CanonicalVacancy.js";

export interface CanonicalCandidate<T> {
  readonly value: T;
  readonly supportingEvidenceIds: readonly CanonicalEvidenceRefId[];
  readonly confidence?: number;
}

export interface CanonicalizeVacancyInput {
  readonly id: CanonicalVacancyId;
  readonly sourceObservationIds: readonly SourceObservationId[];
  readonly evidenceReferences: readonly CanonicalEvidenceReference[];
  readonly roleCandidates?: readonly CanonicalCandidate<VacancyRole>[];
  readonly organizationRelationships?: readonly VacancyOrganizationRelationship[];
  readonly publicationLanguageCandidates?: readonly CanonicalCandidate<readonly PublicationLanguage[]>[];
  readonly locationCandidates?: readonly CanonicalCandidate<VacancyLocation>[];
  readonly workModeCandidates?: readonly CanonicalCandidate<VacancyWorkMode>[];
  readonly remoteEligibleCountryCandidates?: readonly CanonicalCandidate<readonly string[]>[];
  readonly travelCandidates?: readonly CanonicalCandidate<VacancyTravel>[];
  readonly engagementCandidates?: readonly CanonicalCandidate<VacancyEngagement>[];
  readonly compensationCandidates?: readonly CanonicalCandidate<VacancyCompensation>[];
  readonly experienceCandidates?: readonly CanonicalCandidate<readonly ExperienceRequirement[]>[];
  readonly educationCandidates?: readonly CanonicalCandidate<readonly EducationRequirement[]>[];
  readonly skillCandidates?: readonly CanonicalCandidate<readonly SkillRequirement[]>[];
  readonly languageRequirementCandidates?: readonly CanonicalCandidate<readonly VacancyLanguageRequirement[]>[];
  readonly functionalContextCandidates?: readonly CanonicalCandidate<readonly FunctionalContext[]>[];
  readonly industryContextCandidates?: readonly CanonicalCandidate<readonly IndustryContext[]>[];
  readonly positionCountCandidates?: readonly CanonicalCandidate<VacancyPositionCount>[];
  readonly lifecycleCandidates?: readonly CanonicalCandidate<VacancyLifecycleStatus>[];
  readonly derivation: CanonicalDerivationMetadata;
}

export interface CanonicalVacancyCanonicalizer {
  canonicalize(input: CanonicalizeVacancyInput): CanonicalVacancy;
}
