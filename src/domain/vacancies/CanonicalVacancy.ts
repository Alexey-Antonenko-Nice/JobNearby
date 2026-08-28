import type { SourceObservationId } from "../capture/SourceObservation.js";
import type { EmployerClusterId } from "../recognition/EmployerCluster.js";
import type { CanonicalEvidenceRefId } from "./CanonicalEvidenceReference.js";
import type { CanonicalDerivationMetadata, CanonicalField } from "./CanonicalField.js";

export type CanonicalVacancyId = string;
export type CanonicalizationStatus = "PARTIAL" | "USABLE" | "CONFLICTED";

export interface VacancyRole {
  readonly title: string;
  readonly normalizedTitle?: string;
}

export type VacancyOrganizationRole =
  | "DISPLAYED_COMPANY"
  | "EMPLOYER"
  | "RECRUITER"
  | "STAFFING_AGENCY"
  | "CONSULTANCY"
  | "CLIENT"
  | "PROJECT_CUSTOMER"
  | "UNKNOWN";

export interface VacancyOrganizationRelationship {
  readonly organizationId?: string;
  readonly employerClusterId?: EmployerClusterId;
  readonly rawName?: string;
  readonly role: VacancyOrganizationRole;
  readonly confidence?: number;
  readonly supportingEvidenceIds: readonly CanonicalEvidenceRefId[];
  readonly derivation: CanonicalDerivationMetadata;
}

export type PublicationLanguage = string;

export interface VacancyLocation {
  readonly rawText?: string;
  readonly city?: string;
  readonly region?: string;
  readonly countryCode?: string;
  readonly employerLocationId?: string;
}

export type VacancyWorkMode = "ON_SITE" | "HYBRID" | "REMOTE";

export interface VacancyTravel {
  readonly requirement: "REQUIRED" | "NOT_REQUIRED";
  readonly scopeText?: string;
  readonly frequencyText?: string;
}

export interface VacancyEngagement {
  readonly rawTerms: readonly string[];
  readonly normalizedTerms: readonly string[];
}

export interface VacancyCompensation {
  readonly rawText?: string;
  readonly currency?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly period?: "HOUR" | "MONTH" | "YEAR";
}

export interface ExperienceRequirement {
  readonly rawText: string;
  readonly minimumYears?: number;
  readonly context?: string;
}

export interface EducationRequirement {
  readonly rawText: string;
  readonly normalizedLevel?: string;
}

export interface SkillRequirement {
  readonly skill: string;
  readonly rawText?: string;
}

export interface VacancyLanguageRequirement {
  readonly language: string;
  readonly requirement: "REQUIRED" | "PREFERRED" | "ACCEPTABLE";
  readonly level?: string;
  readonly rawText?: string;
}

export type FunctionalContext = string;
export type IndustryContext = string;

export type VacancyPositionCount =
  | { readonly type: "EXACT"; readonly value: number }
  | { readonly type: "MINIMUM"; readonly value: number }
  | { readonly type: "RANGE"; readonly minimum: number; readonly maximum: number }
  | { readonly type: "PLURAL_UNKNOWN" };

export type VacancyLifecycleStatus = "OPEN" | "CLOSED" | "EXPIRED";

export interface CanonicalVacancy {
  readonly id: CanonicalVacancyId;
  readonly sourceObservationIds: readonly SourceObservationId[];
  readonly role: CanonicalField<VacancyRole>;
  readonly organizationRelationships: readonly VacancyOrganizationRelationship[];
  readonly publicationLanguages: CanonicalField<readonly PublicationLanguage[]>;
  readonly location: CanonicalField<VacancyLocation>;
  readonly workMode: CanonicalField<VacancyWorkMode>;
  readonly remoteEligibleCountries: CanonicalField<readonly string[]>;
  readonly travel: CanonicalField<VacancyTravel>;
  readonly engagement: CanonicalField<VacancyEngagement>;
  readonly compensation: CanonicalField<VacancyCompensation>;
  readonly experienceRequirements: CanonicalField<readonly ExperienceRequirement[]>;
  readonly educationRequirements: CanonicalField<readonly EducationRequirement[]>;
  readonly skillRequirements: CanonicalField<readonly SkillRequirement[]>;
  readonly languageRequirements: CanonicalField<readonly VacancyLanguageRequirement[]>;
  readonly functionalContexts: CanonicalField<readonly FunctionalContext[]>;
  readonly industryContexts: CanonicalField<readonly IndustryContext[]>;
  readonly positionCount: CanonicalField<VacancyPositionCount>;
  readonly lifecycleStatus: CanonicalField<VacancyLifecycleStatus>;
  readonly canonicalizationStatus: CanonicalizationStatus;
  readonly derivation: CanonicalDerivationMetadata;
}
