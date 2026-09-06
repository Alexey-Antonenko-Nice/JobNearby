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

export class DirectFieldVacancyEvidenceExtractor
  implements VacancyEvidenceExtractor
{
  async extract(
    input: VacancyEvidenceExtractionInput,
  ): Promise<ExtractedVacancyEvidence> {
    const observation = normalizeVacancyEvidenceInput(input);
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "DIRECT_FIELD" as const,
      confidence: 1,
    };

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations: [
        ...(observation.displayedCompanyName === undefined ? [] : [{
          value: observation.displayedCompanyName,
          role: "UNKNOWN" as const,
          provenance,
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
      engagements: directEngagement(observation.contractText, provenance),
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
