import type {
  ExperienceRequirement,
  VacancyLanguageRequirement,
  VacancyTravel,
} from "../vacancies/CanonicalVacancy.js";
import {
  createEvidenceProvenance,
  requireEvidenceText,
  type EvidenceProvenance,
} from "./EvidenceProvenance.js";

export interface LanguageRequirementEvidence extends VacancyLanguageRequirement {
  readonly rawText: string;
  readonly provenance: EvidenceProvenance;
}

export interface ExperienceRequirementEvidence extends ExperienceRequirement {
  readonly provenance: EvidenceProvenance;
}

export interface TravelRequirementEvidence extends VacancyTravel {
  readonly rawText: string;
  readonly provenance: EvidenceProvenance;
}

export function createLanguageRequirementEvidence(
  evidence: LanguageRequirementEvidence,
): LanguageRequirementEvidence {
  return {
    language: requireEvidenceText(evidence.language, "Language requirement language"),
    requirement: evidence.requirement,
    ...(evidence.level === undefined ? {} : { level: requireEvidenceText(evidence.level, "Language requirement level") }),
    rawText: requireEvidenceText(evidence.rawText, "Language requirement raw text"),
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}

export function createExperienceRequirementEvidence(
  evidence: ExperienceRequirementEvidence,
): ExperienceRequirementEvidence {
  if (!Number.isFinite(evidence.minimumYears) || evidence.minimumYears < 0) {
    throw new Error("Experience requirement minimum years must be finite and non-negative.");
  }
  if (evidence.maximumYears !== undefined && (
    !Number.isFinite(evidence.maximumYears) || evidence.maximumYears < evidence.minimumYears
  )) throw new Error("Experience requirement maximum years must be at least the minimum.");
  return {
    rawText: requireEvidenceText(evidence.rawText, "Experience requirement raw text"),
    minimumYears: evidence.minimumYears,
    ...(evidence.maximumYears === undefined ? {} : { maximumYears: evidence.maximumYears }),
    unit: "YEAR",
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}

export function createTravelRequirementEvidence(
  evidence: TravelRequirementEvidence,
): TravelRequirementEvidence {
  if (evidence.percentage !== undefined && (
    !Number.isFinite(evidence.percentage) || evidence.percentage < 0 || evidence.percentage > 100
  )) throw new Error("Travel percentage must be between 0 and 100.");
  return {
    requirement: evidence.requirement,
    rawText: requireEvidenceText(evidence.rawText, "Travel requirement raw text"),
    ...(evidence.frequency === undefined ? {} : { frequency: evidence.frequency }),
    ...(evidence.scope === undefined ? {} : { scope: evidence.scope }),
    ...(evidence.percentage === undefined ? {} : { percentage: evidence.percentage }),
    ...(evidence.frequencyText === undefined ? {} : { frequencyText: evidence.frequencyText }),
    ...(evidence.scopeText === undefined ? {} : { scopeText: evidence.scopeText }),
    provenance: createEvidenceProvenance(evidence.provenance),
  };
}
