import { createHash } from "node:crypto";

import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { EmployerCharacteristicEvidence } from "../../domain/evidence/EmployerCharacteristicEvidence.js";
import type { EvidenceProvenance } from "../../domain/evidence/EvidenceProvenance.js";
import type { ExtractedVacancyEvidence } from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { ExternalIdentifierEvidence } from "../../domain/evidence/ExternalIdentifierEvidence.js";
import type { LocationEvidence } from "../../domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../domain/evidence/OrganizationEvidence.js";
import type { PersonEvidence } from "../../domain/evidence/PersonEvidence.js";
import type { EmployerCluster } from "../../domain/recognition/EmployerCluster.js";
import type { CanonicalEvidenceReference } from "../../domain/vacancies/CanonicalEvidenceReference.js";
import type { CanonicalDerivationMetadata } from "../../domain/vacancies/CanonicalField.js";
import type {
  CanonicalVacancy,
  CanonicalVacancyId,
  VacancyOrganizationRelationship,
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
    }>[] = [];

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
            normalizedTerms: [],
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
        compensationCandidates.push({
          value: { rawText: observation.salaryText.trim() },
          supportingEvidenceIds: [id],
        });
      }
    }

    const organizationRelationships: VacancyOrganizationRelationship[] = [];
    const locationCandidates: CanonicalCandidate<{ readonly rawText?: string }>[] = [];
    const industryContextCandidates: CanonicalCandidate<readonly string[]>[] = [];

    for (const aggregate of input.extractedEvidence) {
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
      organizationRelationships,
      locationCandidates,
      engagementCandidates,
      compensationCandidates,
      industryContextCandidates,
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
    | PersonEvidence,
  qualifier: string,
): CollectedReference {
  return collectReference(
    references,
    evidence.provenance,
    kind,
    evidence.value,
    qualifier,
  );
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
