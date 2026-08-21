import type { SourceObservation } from "../../domain/capture/SourceObservation.js";
import type { VacancyEvidenceExtractor } from "../../domain/evidence/VacancyEvidenceExtractor.js";
import {
  createExtractedVacancyEvidence,
  type ExtractedVacancyEvidence,
} from "../../domain/evidence/ExtractedVacancyEvidence.js";

export class DirectFieldVacancyEvidenceExtractor
  implements VacancyEvidenceExtractor
{
  async extract(
    observation: SourceObservation,
  ): Promise<ExtractedVacancyEvidence> {
    const provenance = {
      sourceObservationId: observation.id,
      extractionMethod: "DIRECT_FIELD" as const,
      confidence: 1,
    };

    return createExtractedVacancyEvidence({
      sourceObservationId: observation.id,
      organizations:
        observation.displayedCompanyName === undefined
          ? []
          : [
              {
                value: observation.displayedCompanyName,
                role: "UNKNOWN",
                provenance,
              },
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
