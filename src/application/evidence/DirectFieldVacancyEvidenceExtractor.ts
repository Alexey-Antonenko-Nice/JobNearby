import { scopeDaimlerTruckVacancyEvidence } from "./scopeDaimlerTruckVacancyEvidence.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import {
  normalizeVacancyEvidenceInput,
  type VacancyEvidenceExtractionInput,
} from "../../domain/evidence/VacancyEvidenceInput.js";
import {
  createExtractedVacancyEvidence,
  type ExtractedVacancyEvidence,
} from "../../domain/evidence/ExtractedVacancyEvidence.js";
import { directEmployerOrganizationNames } from "./TrustedDirectEmployerSource.js";
import type { VacancyEngagementEvidence } from "../../domain/evidence/VacancyEngagementEvidence.js";
import { AIRBUS_WORKDAY_HOST } from "../acquisition/AirbusWorkdayVacancy.js";
import { airbusDetailsRoute, airbusSelectedPaneOwnedFields } from "../acquisition/AirbusSelectedPaneVacancy.js";

export class DirectFieldVacancyEvidenceExtractor
  implements VacancyEvidenceExtractor
{
  async extract(
    input: VacancyEvidenceExtractionInput,
  ): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(scopeDaimlerTruckVacancyEvidence(input));
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "DIRECT_FIELD" as const,
      confidence: 1,
    };
    const selectedPane = observation.source.sourceName === AIRBUS_WORKDAY_HOST
      && airbusDetailsRoute(observation.source.sourceUrl ?? "") !== undefined
      && observation.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT"
      && observation.evidenceContent.context.providerKey === "AIRBUS_WORKDAY";
    const selectedPaneProvenance = { ...provenance, contentOrigin: "SELECTED_VACANCY_CONTEXT" as const };
    const ownedFields = selectedPane && observation.evidenceContent.kind === "SELECTED_VACANCY_CONTEXT"
      ? airbusSelectedPaneOwnedFields(observation.evidenceContent.context.html ?? "")
      : undefined;
    const companyName = ownedFields?.company ?? observation.displayedCompanyName;
    const employmentType = selectedPane ? ownedFields?.employmentType : undefined;

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      vacancyTitles: observation.title === undefined ? [] : [{ value: observation.title, provenance }],
      organizations: [
        ...(companyName === undefined ? [] : [{
          value: companyName,
          role: selectedPane ? "DISPLAYED_COMPANY" as const : "UNKNOWN" as const,
          provenance: selectedPane ? selectedPaneProvenance : provenance,
        }]),
        ...directEmployerOrganizationNames(observation).map((value) => ({
          value,
          role: "EMPLOYER" as const,
          provenance,
        })),
      ],
      locations:
        observation.locationText === undefined
          ? []
          : [
              {
                value: observation.locationText,
                role: "DISPLAYED_LOCATION",
                provenance,
              },
            ],
      engagements: [
        ...directEngagement(observation.contractText, provenance),
        ...(employmentType !== undefined && /^fixed\s+term$/iu.test(employmentType.trim())
          ? [{ rawTerms: [employmentType], normalizedTerms: ["FIXED_TERM"], provenance: selectedPaneProvenance }]
          : []),
      ],
      externalIdentifiers:
        observation.source.externalId === undefined
          ? []
          : [
              {
                value: observation.source.externalId,
                provider: observation.source.sourceName,
                identifierType: "SOURCE_EXTERNAL_ID",
                provenance,
              },
            ],
    });
  }
}

function directEngagement(
  contractText: string | undefined,
  provenance: { readonly sourceObservationId: string; readonly extractionMethod: "DIRECT_FIELD"; readonly confidence: number },
): readonly VacancyEngagementEvidence[] {
  if (contractText === undefined) return [];
  if (/^full\s+time$/iu.test(contractText.trim())) return [{ rawTerms: [contractText], normalizedTerms: ["FULL_TIME"], provenance }];
  if (/^part\s+time$/iu.test(contractText.trim())) return [{ rawTerms: [contractText], normalizedTerms: ["PART_TIME"], provenance }];
  return [];
}
