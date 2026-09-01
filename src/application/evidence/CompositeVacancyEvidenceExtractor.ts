import type { EmployerCharacteristicEvidence } from "../../domain/evidence/EmployerCharacteristicEvidence.js";
import type { EvidenceProvenance } from "../../domain/evidence/EvidenceProvenance.js";
import type { ExternalIdentifierEvidence } from "../../domain/evidence/ExternalIdentifierEvidence.js";
import {
  createExtractedVacancyEvidence,
  type ExtractedVacancyEvidence,
} from "../../domain/evidence/ExtractedVacancyEvidence.js";
import type { LocationEvidence } from "../../domain/evidence/LocationEvidence.js";
import type { OrganizationEvidence } from "../../domain/evidence/OrganizationEvidence.js";
import type { PersonEvidence } from "../../domain/evidence/PersonEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import type { VacancyTitleEvidence } from "../../domain/evidence/VacancyTitleEvidence.js";
import type { VacancyEngagementEvidence } from "../../domain/evidence/VacancyEngagementEvidence.js";
import type { VacancyWorkModeEvidence } from "../../domain/evidence/VacancyWorkModeEvidence.js";
import type { VacancyCompensationEvidence } from "../../domain/evidence/VacancyCompensationEvidence.js";
import type {
  ExperienceRequirementEvidence,
  LanguageRequirementEvidence,
  TravelRequirementEvidence,
} from "../../domain/evidence/CandidateRequirementEvidence.js";
import {
  normalizeVacancyEvidenceInput,
  type VacancyEvidenceExtractionInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";

export class CompositeVacancyEvidenceExtractor
  implements VacancyEvidenceExtractor
{
  constructor(private readonly extractors: readonly VacancyEvidenceExtractor[]) {}

  async extract(
    input: VacancyEvidenceExtractionInput,
  ): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const results = await Promise.all(
      this.extractors.map((extractor) => extractor.extract(observation)),
    );
    for (const result of results) {
      if (result.sourceObservationId !== observation.id) {
        throw new Error(
          "Composite evidence must originate from the extracted source observation.",
        );
      }
    }

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations: unique(
        results.flatMap(({ organizations }) => organizations),
        organizationKey,
      ),
      locations: unique(
        results.flatMap(({ locations }) => locations),
        locationKey,
      ),
      people: unique(results.flatMap(({ people }) => people), personKey),
      employerCharacteristics: unique(
        results.flatMap(
          ({ employerCharacteristics }) => employerCharacteristics,
        ),
        characteristicKey,
      ),
      externalIdentifiers: unique(
        results.flatMap(({ externalIdentifiers }) => externalIdentifiers),
        externalIdentifierKey,
      ),
      vacancyTitles: unique(results.flatMap(({ vacancyTitles }) => vacancyTitles), titleKey),
      engagements: unique(results.flatMap(({ engagements }) => engagements), engagementKey),
      workModes: unique(results.flatMap(({ workModes }) => workModes), workModeKey),
      compensations: unique(results.flatMap(({ compensations }) => compensations), compensationKey),
      languageRequirements: unique(results.flatMap(({ languageRequirements }) => languageRequirements), languageRequirementKey),
      experienceRequirements: unique(results.flatMap(({ experienceRequirements }) => experienceRequirements), experienceRequirementKey),
      travelRequirements: unique(results.flatMap(({ travelRequirements }) => travelRequirements), travelRequirementKey),
    });
  }
}

function languageRequirementKey(evidence: LanguageRequirementEvidence): string {
  return `${evidence.language}\u0000${evidence.requirement}\u0000${evidence.level ?? ""}\u0000${evidence.rawText}\u0000${provenanceKey(evidence.provenance)}`;
}

function experienceRequirementKey(evidence: ExperienceRequirementEvidence): string {
  return `${evidence.minimumYears}\u0000${evidence.maximumYears ?? ""}\u0000${evidence.rawText}\u0000${provenanceKey(evidence.provenance)}`;
}

function travelRequirementKey(evidence: TravelRequirementEvidence): string {
  return `${evidence.requirement}\u0000${evidence.frequency ?? ""}\u0000${evidence.scope ?? ""}\u0000${evidence.percentage ?? ""}\u0000${evidence.rawText}\u0000${provenanceKey(evidence.provenance)}`;
}

function titleKey(evidence: VacancyTitleEvidence): string {
  return `${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function engagementKey(evidence: VacancyEngagementEvidence): string {
  return `${evidence.rawTerms.join("|")}\u0000${evidence.normalizedTerms.join("|")}\u0000${provenanceKey(evidence.provenance)}`;
}

function workModeKey(evidence: VacancyWorkModeEvidence): string {
  return `${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function compensationKey(evidence: VacancyCompensationEvidence): string {
  return `${evidence.rawText}\u0000${evidence.currency ?? ""}\u0000${evidence.minimum ?? ""}\u0000${evidence.maximum ?? ""}\u0000${evidence.period ?? ""}\u0000${provenanceKey(evidence.provenance)}`;
}

function provenanceKey(provenance: EvidenceProvenance): string {
  return `${provenance.sourceObservationId}\u0000${provenance.extractionMethod}\u0000${provenance.confidence}\u0000${provenance.contentOrigin ?? "SOURCE_OBSERVATION"}`;
}

function organizationKey(evidence: OrganizationEvidence): string {
  return `${evidence.role}\u0000${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function locationKey(evidence: LocationEvidence): string {
  return `${evidence.role}\u0000${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function personKey(evidence: PersonEvidence): string {
  return `${evidence.role}\u0000${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function characteristicKey(evidence: EmployerCharacteristicEvidence): string {
  return `${evidence.category}\u0000${evidence.specificity}\u0000${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function externalIdentifierKey(evidence: ExternalIdentifierEvidence): string {
  return `${evidence.provider}\u0000${evidence.identifierType}\u0000${evidence.value}\u0000${provenanceKey(evidence.provenance)}`;
}

function unique<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
