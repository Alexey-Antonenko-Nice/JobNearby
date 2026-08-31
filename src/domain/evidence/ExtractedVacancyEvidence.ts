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
import {
  createVacancyTitleEvidence,
  type VacancyTitleEvidence,
} from "./VacancyTitleEvidence.js";
import {
  createVacancyEngagementEvidence,
  type VacancyEngagementEvidence,
} from "./VacancyEngagementEvidence.js";
import {
  createVacancyWorkModeEvidence,
  type VacancyWorkModeEvidence,
} from "./VacancyWorkModeEvidence.js";
import {
  createVacancyCompensationEvidence,
  type VacancyCompensationEvidence,
} from "./VacancyCompensationEvidence.js";

export interface ExtractedVacancyEvidence {
  readonly sourceObservationId: SourceObservationId;
  readonly organizations: readonly OrganizationEvidence[];
  readonly locations: readonly LocationEvidence[];
  readonly people: readonly PersonEvidence[];
  readonly employerCharacteristics: readonly EmployerCharacteristicEvidence[];
  readonly externalIdentifiers: readonly ExternalIdentifierEvidence[];
  readonly vacancyTitles: readonly VacancyTitleEvidence[];
  readonly engagements: readonly VacancyEngagementEvidence[];
  readonly workModes: readonly VacancyWorkModeEvidence[];
  readonly compensations: readonly VacancyCompensationEvidence[];
}

export interface CreateExtractedVacancyEvidenceInput {
  readonly sourceObservationId: SourceObservationId;
  readonly organizations?: readonly OrganizationEvidence[];
  readonly locations?: readonly LocationEvidence[];
  readonly people?: readonly PersonEvidence[];
  readonly employerCharacteristics?: readonly EmployerCharacteristicEvidence[];
  readonly externalIdentifiers?: readonly ExternalIdentifierEvidence[];
  readonly vacancyTitles?: readonly VacancyTitleEvidence[];
  readonly engagements?: readonly VacancyEngagementEvidence[];
  readonly workModes?: readonly VacancyWorkModeEvidence[];
  readonly compensations?: readonly VacancyCompensationEvidence[];
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
    vacancyTitles: (input.vacancyTitles ?? []).map(createVacancyTitleEvidence),
    engagements: (input.engagements ?? []).map(createVacancyEngagementEvidence),
    workModes: (input.workModes ?? []).map(createVacancyWorkModeEvidence),
    compensations: (input.compensations ?? []).map(
      createVacancyCompensationEvidence,
    ),
  };

  const allEvidence = [
    ...result.organizations,
    ...result.locations,
    ...result.people,
    ...result.employerCharacteristics,
    ...result.externalIdentifiers,
    ...result.vacancyTitles,
    ...result.engagements,
    ...result.workModes,
    ...result.compensations,
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
