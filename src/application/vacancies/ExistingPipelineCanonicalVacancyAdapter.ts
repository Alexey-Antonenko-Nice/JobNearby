import { createHash } from "node:crypto";

import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerCharacteristicEvidence } from "../../domain/evidence/EmployerCharacteristicEvidence.js";
import type { EvidenceProvenance } from "../../domain/evidence/EvidenceProvenance.js";
import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { ExternalIdentifierEvidence } from "../../domain/evidence/ExternalIdentifierEvidence.js";
import type { LocationEvidence } from "../../domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../domain/evidence/OrganizationEvidence.js";
import { normalizeOrganizationEvidenceName } from "../../domain/evidence/OrganizationEvidence.js";
import type { PersonEvidence } from "../../domain/evidence/PersonEvidence.js";
import type { VacancyTitleEvidence } from "../../domain/evidence/VacancyTitleEvidence.js";
import type { VacancyEngagementEvidence } from "../../domain/evidence/VacancyEngagementEvidence.js";
import type { VacancyWorkModeEvidence } from "../../domain/evidence/VacancyWorkModeEvidence.js";
import type { VacancyCompensationEvidence } from "../../domain/evidence/VacancyCompensationEvidence.js";
import type {
  ExperienceRequirementEvidence,
  LanguageRequirementEvidence,
  TravelRequirementEvidence,
} from "../../domain/evidence/CandidateRequirementEvidence.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { CanonicalEvidenceReference } from "../../domain/vacancies/CanonicalEvidenceReference.js";
import type { CanonicalDerivationMetadata } from "../../domain/vacancies/CanonicalField.js";
import type {
  CanonicalVacancy,
  CanonicalVacancyId,
  VacancyOrganizationRelationship,
  ExperienceRequirement,
  VacancyLanguageRequirement,
  VacancyTravel,
} from "../../domain/vacancies/CanonicalVacancy.js";
import type {
  CanonicalCandidate,
  CanonicalizeVacancyInput,
  CanonicalVacancyCanonicalizer,
} from "./CanonicalVacancyCanonicalizer.js";

export interface ExistingPipelineCanonicalVacancyAdapterInput {
  readonly canonicalVacancyId: CanonicalVacancyId;
  readonly observations: readonly SourceObservation[];
  readonly extractedEvidence: readonly ExtractedVacancyEvidence[];
  readonly employerCluster?: EmployerCluster;
  readonly derivation: CanonicalDerivationMetadata;
}

interface CollectedReference {
  readonly reference: CanonicalEvidenceReference;
  readonly id: string;
}

export class ExistingPipelineCanonicalVacancyAdapter {
  constructor(private readonly canonicalizer: CanonicalVacancyCanonicalizer) {}

  canonicalize(
    input: ExistingPipelineCanonicalVacancyAdapterInput,
  ): CanonicalVacancy {
    return this.canonicalizer.canonicalize(this.buildCanonicalizeInput(input));
  }

  buildCanonicalizeInput(
    input: ExistingPipelineCanonicalVacancyAdapterInput,
  ): CanonicalizeVacancyInput {
    const observationIds = input.observations.map(({ id }) => id);
    const observationIdSet = new Set(observationIds);
    if (observationIds.length === 0 || observationIdSet.size !== observationIds.length) {
      throw new Error("Adapter input requires unique source observations.");
    }
    for (const evidence of input.extractedEvidence) {
      if (!observationIdSet.has(evidence.sourceObservationId)) {
        throw new Error("Extracted evidence must belong to a supplied source observation.");
      }
    }

    const references = new Map<string, CanonicalEvidenceReference>();
    const addReference = (
      sourceObservationId: string,
      kind: string,
      value: string,
      qualifier = "",
    ): CollectedReference => {
      const id = evidenceReferenceId(
        sourceObservationId,
        kind,
        value,
        qualifier,
      );
      const reference = { id, sourceObservationId, kind };
      references.set(id, reference);
      return { id, reference };
    };

    const roleCandidates: CanonicalCandidate<{ readonly title: string }>[] = [];
    const engagementCandidates: CanonicalCandidate<{
      readonly rawTerms: readonly string[];
      readonly normalizedTerms: readonly string[];
    }>[] = [];
    const compensationCandidates: CanonicalCandidate<{
      readonly rawText?: string;
      readonly currency?: string;
      readonly minimum?: number;
      readonly maximum?: number;
      readonly period?: "HOUR" | "MONTH" | "YEAR";
    }>[] = [];
    const workModeCandidates: CanonicalCandidate<
      "ON_SITE" | "HYBRID" | "REMOTE"
    >[] = [];
    const languageRequirementCandidates: CanonicalCandidate<readonly VacancyLanguageRequirement[]>[] = [];
    const experienceCandidates: CanonicalCandidate<readonly ExperienceRequirement[]>[] = [];
    const travelCandidates: CanonicalCandidate<VacancyTravel>[] = [];

    for (const observation of input.observations) {
      if (usable(observation.title)) {
        const { id } = addReference(
          observation.id,
          "SOURCE_TITLE",
          observation.title,
        );
        roleCandidates.push({
          value: { title: observation.title.trim() },
          supportingEvidenceIds: [id],
        });
      }
      if (usable(observation.contractText)) {
        const { id } = addReference(
          observation.id,
          "SOURCE_CONTRACT_TEXT",
          observation.contractText,
        );
        engagementCandidates.push({
          value: {
            rawTerms: [observation.contractText.trim()],
            normalizedTerms: structuredEngagementTerms(observation.contractText),
          },
          supportingEvidenceIds: [id],
        });
      }
      if (usable(observation.salaryText)) {
        const { id } = addReference(
          observation.id,
          "SOURCE_SALARY_TEXT",
          observation.salaryText,
        );
        const value = structuredCompensation(observation.salaryText);
        if (!malformedCompensation(value)) compensationCandidates.push({ value, supportingEvidenceIds: [id] });
      }
    }

    const organizationRelationships: VacancyOrganizationRelationship[] = [];
    const locationCandidates: CanonicalCandidate<{ readonly rawText?: string }>[] = [];
    const industryContextCandidates: CanonicalCandidate<readonly string[]>[] = [];

    for (const aggregate of input.extractedEvidence) {
      for (const title of aggregate.vacancyTitles) {
        const { id } = evidenceItemReference(
          references,
          "VACANCY_TITLE_EVIDENCE",
          title,
        );
        roleCandidates.push({
          value: { title: title.value },
          supportingEvidenceIds: [id],
          confidence: title.provenance.confidence,
        });
      }
      for (const engagement of aggregate.engagements) {
        const { id } = evidenceItemReference(
          references,
          "VACANCY_ENGAGEMENT_EVIDENCE",
          engagement,
        );
        engagementCandidates.push({
          value: {
            rawTerms: engagement.rawTerms,
            normalizedTerms: engagement.normalizedTerms,
          },
          supportingEvidenceIds: [id],
          confidence: engagement.provenance.confidence,
        });
      }
      for (const workMode of aggregate.workModes) {
        const { id } = evidenceItemReference(
          references,
          "VACANCY_WORK_MODE_EVIDENCE",
          workMode,
        );
        workModeCandidates.push({
          value: workMode.value,
          supportingEvidenceIds: [id],
          confidence: workMode.provenance.confidence,
        });
      }
      for (const compensation of aggregate.compensations) {
        const { id } = evidenceItemReference(
          references,
          "VACANCY_COMPENSATION_EVIDENCE",
          compensation,
        );
        const { provenance: _provenance, ...value } = compensation;
        compensationCandidates.push({
          value,
          supportingEvidenceIds: [id],
          confidence: compensation.provenance.confidence,
        });
      }
      if (aggregate.languageRequirements.length > 0) {
        const ids = aggregate.languageRequirements.map((evidence) =>
          evidenceItemReference(references, "LANGUAGE_REQUIREMENT_EVIDENCE", evidence).id);
        languageRequirementCandidates.push({
          value: aggregate.languageRequirements.map(({ provenance: _provenance, ...value }) => value),
          supportingEvidenceIds: ids,
          confidence: Math.min(...aggregate.languageRequirements.map(({ provenance }) => provenance.confidence)),
        });
      }
      if (aggregate.experienceRequirements.length > 0) {
        const ids = aggregate.experienceRequirements.map((evidence) =>
          evidenceItemReference(references, "EXPERIENCE_REQUIREMENT_EVIDENCE", evidence).id);
        experienceCandidates.push({
          value: aggregate.experienceRequirements.map(({ provenance: _provenance, ...value }) => value),
          supportingEvidenceIds: ids,
          confidence: Math.min(...aggregate.experienceRequirements.map(({ provenance }) => provenance.confidence)),
        });
      }
      for (const evidence of aggregate.travelRequirements) {
        const { id } = evidenceItemReference(references, "TRAVEL_REQUIREMENT_EVIDENCE", evidence);
        const { provenance: _provenance, ...value } = evidence;
        travelCandidates.push({ value, supportingEvidenceIds: [id], confidence: evidence.provenance.confidence });
      }
      for (const organization of aggregate.organizations) {
        const { id } = evidenceItemReference(
          references,
          "ORGANIZATION_EVIDENCE",
          organization,
          organization.role,
        );
        organizationRelationships.push({
          rawName: organization.value,
          role: mapOrganizationRole(organization),
          confidence: organization.provenance.confidence,
          supportingEvidenceIds: [id],
          derivation: input.derivation,
        });
      }

      for (const location of aggregate.locations) {
        evidenceItemReference(
          references,
          "LOCATION_EVIDENCE",
          location,
          location.role,
        );
      }
      const industries = aggregate.employerCharacteristics.filter(
        ({ category }) => category === "INDUSTRY",
      );
      if (industries.length > 0) {
        const evidenceIds = industries.map(
          (industry) =>
            evidenceItemReference(
              references,
              "EMPLOYER_CHARACTERISTIC_EVIDENCE",
              industry,
              industry.category,
            ).id,
        );
        industryContextCandidates.push({
          value: industries.map(({ value }) => value),
          supportingEvidenceIds: evidenceIds,
        });
      }

      for (const characteristic of aggregate.employerCharacteristics.filter(
        ({ category }) => category !== "INDUSTRY",
      )) {
        evidenceItemReference(
          references,
          "EMPLOYER_CHARACTERISTIC_EVIDENCE",
          characteristic,
          characteristic.category,
        );
      }
      for (const person of aggregate.people) {
        evidenceItemReference(references, "PERSON_EVIDENCE", person, person.role);
      }
      for (const identifier of aggregate.externalIdentifiers) {
        externalIdentifierReference(references, identifier);
      }
    }

    const reconciledEngagementCandidates = reconcileEngagementCandidates(engagementCandidates);
    const reconciledCompensationCandidates = reconcileCompensationCandidates(compensationCandidates);

    const selectedLocations = selectCanonicalLocations(
      input.extractedEvidence.flatMap(({ locations }) => locations),
    );
    for (const location of selectedLocations) {
      const { id } = evidenceItemReference(
        references,
        "LOCATION_EVIDENCE",
        location,
        location.role,
      );
      locationCandidates.push({
        value: { rawText: location.value },
        supportingEvidenceIds: [id],
        confidence: location.provenance.confidence,
      });
    }

    if (input.employerCluster !== undefined) {
      const supportingEvidenceIds = observationIds.map(
        (observationId) =>
          addReference(
            observationId,
            "EMPLOYER_CLUSTER_RECOGNITION",
            input.employerCluster!.id,
            input.employerCluster!.status,
          ).id,
      );
      organizationRelationships.push({
        employerClusterId: input.employerCluster.id,
        role: "EMPLOYER",
        supportingEvidenceIds,
        derivation: input.derivation,
      });
    }

    return {
      id: input.canonicalVacancyId,
      sourceObservationIds: observationIds,
      evidenceReferences: [...references.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      roleCandidates,
      organizationRelationships: uniqueOrganizationRelationships(organizationRelationships),
      locationCandidates,
      engagementCandidates: reconciledEngagementCandidates,
      compensationCandidates: reconciledCompensationCandidates,
      workModeCandidates,
      industryContextCandidates,
      languageRequirementCandidates,
      experienceCandidates,
      travelCandidates,
      derivation: input.derivation,
    };
  }
}

function mapOrganizationRole(
  evidence: OrganizationEvidence,
): VacancyOrganizationRelationship["role"] {
  return {
    EMPLOYER: "EMPLOYER",
    RECRUITMENT_AGENCY: "RECRUITER",
    STAFFING_AGENCY: "STAFFING_AGENCY",
    RECRUITER: "RECRUITER",
    CONSULTANCY: "CONSULTANCY",
    CLIENT: "CLIENT",
    PUBLISHER: "UNKNOWN",
    UNKNOWN: "DISPLAYED_COMPANY",
  }[evidence.role] as VacancyOrganizationRelationship["role"];
}

function selectCanonicalLocations(
  locations: readonly LocationEvidence[],
): readonly LocationEvidence[] {
  const workplaces = locations.filter(({ role }) => role === "WORKPLACE");
  if (workplaces.length > 0) return workplaces;
  const employerLocations = locations.filter(
    ({ role }) => role === "EMPLOYER_LOCATION",
  );
  if (employerLocations.length > 0) return employerLocations;
  return locations.filter(({ role }) => role === "DISPLAYED_LOCATION");
}

function evidenceItemReference(
  references: Map<string, CanonicalEvidenceReference>,
  kind: string,
  evidence:
    | OrganizationEvidence
    | LocationEvidence
    | EmployerCharacteristicEvidence
    | PersonEvidence
    | VacancyTitleEvidence
    | VacancyEngagementEvidence
    | VacancyWorkModeEvidence
    | VacancyCompensationEvidence
    | LanguageRequirementEvidence
    | ExperienceRequirementEvidence
    | TravelRequirementEvidence,
  qualifier = "",
): CollectedReference {
  return collectReference(
    references,
    evidence.provenance,
    kind,
    evidenceValue(evidence),
    qualifier,
  );
}

function evidenceValue(
  evidence:
    | VacancyTitleEvidence
    | VacancyEngagementEvidence
    | VacancyWorkModeEvidence
    | VacancyCompensationEvidence
    | OrganizationEvidence
    | LocationEvidence
    | EmployerCharacteristicEvidence
    | PersonEvidence
    | LanguageRequirementEvidence
    | ExperienceRequirementEvidence
    | TravelRequirementEvidence,
): string {
  if ("rawTerms" in evidence) return evidence.rawTerms.join("|");
  if ("rawText" in evidence) return evidence.rawText;
  return evidence.value;
}

function externalIdentifierReference(
  references: Map<string, CanonicalEvidenceReference>,
  evidence: ExternalIdentifierEvidence,
): CollectedReference {
  return collectReference(
    references,
    evidence.provenance,
    "EXTERNAL_IDENTIFIER_EVIDENCE",
    evidence.value,
    `${evidence.provider}:${evidence.identifierType}`,
  );
}

function collectReference(
  references: Map<string, CanonicalEvidenceReference>,
  provenance: EvidenceProvenance,
  kind: string,
  value: string,
  qualifier: string,
): CollectedReference {
  const id = evidenceReferenceId(
    provenance.sourceObservationId,
    kind,
    value,
    qualifier,
  );
  const reference = {
    id,
    sourceObservationId: provenance.sourceObservationId,
    kind,
  };
  references.set(id, reference);
  return { id, reference };
}

function evidenceReferenceId(
  sourceObservationId: string,
  kind: string,
  value: string,
  qualifier: string,
): string {
  const identity = [sourceObservationId, kind, qualifier, value]
    .map(normalizeIdentityPart)
    .join("\u0000");
  return `canonical-evidence-${createHash("sha256").update(identity).digest("hex")}`;
}

function normalizeIdentityPart(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function usable(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function uniqueOrganizationRelationships(
  relationships: readonly VacancyOrganizationRelationship[],
): VacancyOrganizationRelationship[] {
  const seen = new Set<string>();
  return relationships.filter((relationship) => {
    const anchor = relationship.rawName === undefined
      ? relationship.employerClusterId ?? relationship.organizationId ?? ""
      : normalizeOrganizationEvidenceName(relationship.rawName);
    const key = `${relationship.role}\u0000${anchor}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type EngagementValue = { readonly rawTerms: readonly string[]; readonly normalizedTerms: readonly string[] };
type CompensationValue = { readonly rawText?: string; readonly currency?: string; readonly minimum?: number; readonly maximum?: number; readonly period?: "HOUR" | "MONTH" | "YEAR" };

function structuredEngagementTerms(value: string): string[] {
  const normalized = value.trim().toLocaleUpperCase();
  return normalized === "FULL_TIME" || normalized === "PART_TIME" || normalized === "CONTRACTOR" || normalized === "TEMPORARY" ? [normalized] : [];
}

function structuredCompensation(rawText: string): CompensationValue {
  const match = /^\s*([\d.]+)\s*-\s*([\d.]+)\s+([A-Z]+)\s*\/\s*(HOUR|MONTH|YEAR)\s*$/u.exec(rawText);
  if (match === null) return { rawText: rawText.trim() };
  const currency = match[3];
  const period = match[4] as CompensationValue["period"] | undefined;
  return {
    rawText: rawText.trim(), minimum: Number(match[1]), maximum: Number(match[2]),
    ...(currency === undefined ? {} : { currency }),
    ...(period === undefined ? {} : { period }),
  };
}

function malformedCompensation(value: CompensationValue): boolean {
  return value.minimum !== undefined && value.minimum > 0 && value.maximum === 0;
}

function reconcileEngagementCandidates(candidates: readonly CanonicalCandidate<EngagementValue>[]): CanonicalCandidate<EngagementValue>[] {
  const contractTerms = new Set(["INDEFINITE", "FIXED_TERM", "INTERIM", "CONTRACTOR", "TEMPORARY"]);
  const contracts = new Set(candidates.flatMap(({ value }) => value.normalizedTerms.filter((term) => contractTerms.has(term))));
  if (contracts.size > 1) return [...candidates];
  const rawTerms = [...new Set(candidates.flatMap(({ value }) => value.rawTerms))];
  const normalizedTerms = [...new Set(candidates.flatMap(({ value }) => value.normalizedTerms))];
  if (rawTerms.length === 0) return [];
  return [{ value: { rawTerms, normalizedTerms }, supportingEvidenceIds: [...new Set(candidates.flatMap(({ supportingEvidenceIds }) => supportingEvidenceIds))] }];
}

function reconcileCompensationCandidates(candidates: readonly CanonicalCandidate<CompensationValue>[]): CanonicalCandidate<CompensationValue>[] {
  const groups = new Map<string, CanonicalCandidate<CompensationValue>[]>();
  for (const candidate of candidates) {
    const { minimum, maximum, currency, period, rawText } = candidate.value;
    const key = minimum === undefined ? `raw:${rawText ?? ""}` : `${minimum}|${maximum ?? ""}|${currency ?? ""}|${period ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()].map((group) => ({
    value: group.find(({ value }) => value.minimum !== undefined)?.value ?? group[0]!.value,
    supportingEvidenceIds: [...new Set(group.flatMap(({ supportingEvidenceIds }) => supportingEvidenceIds))],
    ...(group.every(({ confidence }) => confidence === group[0]!.confidence) && group[0]!.confidence !== undefined ? { confidence: group[0]!.confidence } : {}),
  }));
}
