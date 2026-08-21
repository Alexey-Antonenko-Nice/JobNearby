import type { SourceObservationId } from "../capture/SourceObservation.js";
import {
  createEmployerCharacteristicEvidence,
  type EmployerCharacteristicEvidence,
} from "./EmployerCharacteristicEvidence.js";
import {
  createExternalIdentifierEvidence,
  type ExternalIdentifierEvidence,
} from "./ExternalIdentifierEvidence.js";
import {
  createLocationEvidence,
  type LocationEvidence,
} from "./LocationEvidence.js";
import {
  createOrganizationEvidence,
  type OrganizationEvidence,
} from "./OrganizationEvidence.js";
import {
  createPersonEvidence,
  type PersonEvidence,
} from "./PersonEvidence.js";
import { requireEvidenceText } from "./EvidenceProvenance.js";

export interface ExtractedVacancyEvidence {
  readonly sourceObservationId: SourceObservationId;
  readonly organizations: readonly OrganizationEvidence[];
  readonly locations: readonly LocationEvidence[];
  readonly people: readonly PersonEvidence[];
  readonly employerCharacteristics: readonly EmployerCharacteristicEvidence[];
  readonly externalIdentifiers: readonly ExternalIdentifierEvidence[];
}

export interface CreateExtractedVacancyEvidenceInput {
  readonly sourceObservationId: SourceObservationId;
  readonly organizations?: readonly OrganizationEvidence[];
  readonly locations?: readonly LocationEvidence[];
  readonly people?: readonly PersonEvidence[];
  readonly employerCharacteristics?: readonly EmployerCharacteristicEvidence[];
  readonly externalIdentifiers?: readonly ExternalIdentifierEvidence[];
}

export function createExtractedVacancyEvidence(
  input: CreateExtractedVacancyEvidenceInput,
): ExtractedVacancyEvidence {
  const sourceObservationId = requireEvidenceText(
    input.sourceObservationId,
    "Extracted evidence source observation ID",
  );
  const result: ExtractedVacancyEvidence = {
    sourceObservationId,
    organizations: (input.organizations ?? []).map(createOrganizationEvidence),
    locations: (input.locations ?? []).map(createLocationEvidence),
    people: (input.people ?? []).map(createPersonEvidence),
    employerCharacteristics: (input.employerCharacteristics ?? []).map(
      createEmployerCharacteristicEvidence,
    ),
    externalIdentifiers: (input.externalIdentifiers ?? []).map(
      createExternalIdentifierEvidence,
    ),
  };

  const allEvidence = [
    ...result.organizations,
    ...result.locations,
    ...result.people,
    ...result.employerCharacteristics,
    ...result.externalIdentifiers,
  ];
  if (
    allEvidence.some(
      (evidence) => evidence.provenance.sourceObservationId !== sourceObservationId,
    )
  ) {
    throw new Error(
      "Every evidence item must originate from the extracted evidence source observation.",
    );
  }

  return result;
}
